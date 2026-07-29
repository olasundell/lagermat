const supabaseUrl = Deno.env.get("SUPABASE_URL");
const appOrigin = Deno.env.get("APP_ORIGIN")?.replace(/\/$/, "");
const dabasApiKey = Deno.env.get("DABAS_API_KEY");
const dabasAdapter = Deno.env.get("DABAS_ADAPTER") === "fixture"
  ? "fixture"
  : "dabas";
const dabasApiBaseUrl = (
  Deno.env.get("DABAS_API_BASE_URL")
  ?? "https://api.dabas.com/DABASService/V2"
).replace(/\/$/, "");

function defaultHostedKey(variableName: string): string | null {
  const serialized = Deno.env.get(variableName);
  if (!serialized) return null;
  try {
    const keys = JSON.parse(serialized) as Record<string, unknown>;
    return typeof keys.default === "string" ? keys.default : null;
  } catch {
    return null;
  }
}

const publishableKey = defaultHostedKey("SUPABASE_PUBLISHABLE_KEYS")
  ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")
  ?? Deno.env.get("SUPABASE_ANON_KEY");

interface CatalogueRequest {
  action?: unknown;
  organizationId?: unknown;
  gtins?: unknown;
  query?: unknown;
}

interface DabasProduct {
  gtin: string;
  displayName: string | null;
  brand: string | null;
  packageDescription: string | null;
  manufacturerArticleNumber: string | null;
}

const fixtureProducts: Readonly<Record<string, DabasProduct>> = {
  "07310865004703": {
    gtin: "07310865004703",
    displayName: "Gräddfil 12 procent",
    brand: "Arla",
    packageDescription: "12 x 3 dl",
    manufacturerArticleNumber: "168278",
  },
};

function corsHeaders(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    ...(origin && origin === appOrigin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Vary": "Origin",
  };
}

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

function normaliseGtins(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const gtins = [...new Set(value.map((item) => (
    typeof item === "string" ? item.trim() : ""
  )))];
  return gtins.every((gtin) => /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin))
    ? gtins
    : null;
}

async function apiFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: publishableKey!,
      ...init.headers,
    },
  });
}

function findString(value: unknown, names: string[]): string | null {
  if (!value || typeof value !== "object") return null;
  const entries = Object.entries(value);
  for (const name of names) {
    const direct = entries.find(([key]) => key.toLocaleLowerCase("sv-SE") === name.toLocaleLowerCase("sv-SE"));
    if (direct && (typeof direct[1] === "string" || typeof direct[1] === "number")) {
      const text = String(direct[1]).trim();
      if (text) return text;
    }
  }
  for (const [, child] of entries) {
    if (child && typeof child === "object") {
      const nested = Array.isArray(child)
        ? child.map((item) => findString(item, names)).find(Boolean) ?? null
        : findString(child, names);
      if (nested) return nested;
    }
  }
  return null;
}

function normaliseDabasProduct(gtin: string, payload: unknown): DabasProduct {
  return {
    gtin,
    displayName: findString(payload, ["Artikelbenamning", "Artikelbenämning"]),
    brand: findString(payload, ["Varumarke", "Varumärke"]),
    packageDescription: findString(payload, ["Forpackningsstorlek", "Förpackningsstorlek"]),
    manufacturerArticleNumber: findString(payload, [
      "TillverkarensArtikelnummer",
      "Tillverkarens artikelnummer",
    ]),
  };
}

async function fetchDabasProduct(gtin: string): Promise<DabasProduct | null> {
  const url = new URL(`${dabasApiBaseUrl}/article/gtin/${gtin}/JSON`);
  url.searchParams.set("apikey", dabasApiKey!);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Dabas returned ${response.status}`);
  }
  return normaliseDabasProduct(gtin, await response.json());
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");

  if (!supabaseUrl || !publishableKey || !appOrigin) {
    return jsonResponse({ error: "Serverkonfigurationen är ofullständig." }, 500, origin);
  }
  if (origin !== appOrigin) {
    return jsonResponse({ error: "Anropet kommer från en otillåten webbplats." }, 403, origin);
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Metoden stöds inte." }, 405, origin);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Inloggning krävs." }, 401, origin);
  }

  const userResponse = await apiFetch("/auth/v1/user", {
    method: "GET",
    headers: { Authorization: authorization },
  });
  if (!userResponse.ok) {
    return jsonResponse({ error: "Sessionen är ogiltig eller har gått ut." }, 401, origin);
  }
  const user = await userResponse.json() as { id?: string };
  if (!user.id) {
    return jsonResponse({ error: "Sessionen saknar användare." }, 401, origin);
  }

  let body: CatalogueRequest;
  try {
    body = await request.json() as CatalogueRequest;
  } catch {
    return jsonResponse({ error: "Ogiltig JSON." }, 400, origin);
  }
  if (!isUuid(body.organizationId)) {
    return jsonResponse({ error: "Organisationen är ogiltig." }, 400, origin);
  }

  const membershipQuery = new URLSearchParams({
    organization_id: `eq.${body.organizationId}`,
    user_id: `eq.${user.id}`,
    status: "eq.active",
    select: "organization_id",
  });
  const membershipResponse = await apiFetch(
    `/rest/v1/organization_memberships?${membershipQuery}`,
    { method: "GET", headers: { Authorization: authorization } },
  );
  const memberships = membershipResponse.ok
    ? await membershipResponse.json() as Array<{ organization_id: string }>
    : [];
  if (memberships.length !== 1) {
    return jsonResponse({ error: "Aktivt organisationsmedlemskap krävs." }, 403, origin);
  }

  if (body.action !== "enrich-gtins") {
    return jsonResponse({ error: "Åtgärden stöds inte." }, 400, origin);
  }
  const gtins = normaliseGtins(body.gtins);
  if (!gtins) {
    return jsonResponse({ error: "GTIN-listan är ogiltig eller för stor." }, 400, origin);
  }
  if (dabasAdapter === "fixture") {
    return jsonResponse({
      configured: false,
      adapter: "fixture",
      products: gtins.flatMap((gtin) => fixtureProducts[gtin] ? [fixtureProducts[gtin]] : []),
      failures: [],
    }, 200, origin);
  }
  if (!dabasApiKey) {
    return jsonResponse({
      configured: false,
      adapter: "none",
      products: [],
      failures: [],
    }, 200, origin);
  }

  const settled = await Promise.allSettled(gtins.map(fetchDabasProduct));
  const products: DabasProduct[] = [];
  const failures: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      if (result.value) products.push(result.value);
    } else {
      failures.push(gtins[index]!);
    }
  });

  return jsonResponse({
    configured: true,
    adapter: "dabas",
    products,
    failures,
  }, failures.length ? 207 : 200, origin);
});
