function defaultHostedKey(variable: string): string | undefined {
  const value = Deno.env.get(variable);
  if (!value) return undefined;

  try {
    const keys = JSON.parse(value) as Record<string, unknown>;
    return typeof keys.default === "string" && keys.default.length > 0
      ? keys.default
      : undefined;
  } catch {
    return undefined;
  }
}

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const publishableKey = defaultHostedKey("SUPABASE_PUBLISHABLE_KEYS")
  ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")
  ?? Deno.env.get("SUPABASE_ANON_KEY");
const secretKey = defaultHostedKey("SUPABASE_SECRET_KEYS")
  ?? Deno.env.get("SUPABASE_SECRET_KEY")
  ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const appOrigin = Deno.env.get("APP_ORIGIN")?.replace(/\/$/, "");

type OrganizationRole = "admin" | "planner";

interface InviteRequest {
  organizationId?: unknown;
  email?: unknown;
  role?: unknown;
}

function corsHeaders(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    ...(origin && origin === appOrigin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Vary": "Origin"
  };
}

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

function normaliseEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function jwtAssuranceLevel(authorization: string): string | null {
  try {
    const token = authorization.slice("Bearer ".length);
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/")
      .padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const claims = JSON.parse(atob(base64)) as { aal?: unknown };
    return typeof claims.aal === "string" ? claims.aal : null;
  } catch {
    return null;
  }
}

function adminAuthorization(apiKey: string): HeadersInit {
  return /^(?:sb_secret_|supabase_secret_)/.test(apiKey)
    ? {}
    : { Authorization: `Bearer ${apiKey}` };
}

async function apiFetch(path: string, init: RequestInit, apiKey: string): Promise<Response> {
  return fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: apiKey,
      ...init.headers
    }
  });
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");

  if (!supabaseUrl || !publishableKey || !secretKey || !appOrigin) {
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
    headers: { Authorization: authorization }
  }, publishableKey);

  if (!userResponse.ok) {
    return jsonResponse({ error: "Sessionen är ogiltig eller har gått ut." }, 401, origin);
  }

  const user = await userResponse.json() as { id?: string };
  if (!user.id) {
    return jsonResponse({ error: "Sessionen saknar användare." }, 401, origin);
  }

  if (jwtAssuranceLevel(authorization) !== "aal2") {
    return jsonResponse({ error: "Tvåfaktorsautentisering krävs för administratörer." }, 403, origin);
  }

  let body: InviteRequest;
  try {
    body = await request.json() as InviteRequest;
  } catch {
    return jsonResponse({ error: "Ogiltig JSON." }, 400, origin);
  }

  const organizationId = body.organizationId;
  const email = normaliseEmail(body.email);
  const role: OrganizationRole | null = body.role === "admin" || body.role === "planner"
    ? body.role
    : null;

  if (!isUuid(organizationId) || !email || !role) {
    return jsonResponse({ error: "Organisation, e-post och roll måste vara giltiga." }, 400, origin);
  }

  const membershipQuery = new URLSearchParams({
    organization_id: `eq.${organizationId}`,
    user_id: `eq.${user.id}`,
    status: "eq.active",
    role: "eq.admin",
    select: "organization_id"
  });
  const membershipResponse = await apiFetch(
    `/rest/v1/organization_memberships?${membershipQuery}`,
    { method: "GET", headers: { Authorization: authorization } },
    publishableKey
  );
  const memberships = membershipResponse.ok
    ? await membershipResponse.json() as Array<{ organization_id: string }>
    : [];

  if (memberships.length !== 1) {
    return jsonResponse({ error: "Endast organisationsadministratörer får bjuda in." }, 403, origin);
  }

  const invitationId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const invitationResponse = await apiFetch("/rest/v1/organization_invitations", {
    method: "POST",
    headers: {
      ...adminAuthorization(secretKey),
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify({
      id: invitationId,
      organization_id: organizationId,
      email,
      role,
      token_hash: null,
      invited_by: user.id,
      expires_at: expiresAt
    })
  }, secretKey);

  if (!invitationResponse.ok) {
    const detail = await invitationResponse.json().catch(() => ({})) as {
      code?: string;
      message?: string;
    };
    console.error(JSON.stringify({
      stage: "persist_invitation",
      status: invitationResponse.status,
      code: detail.code ?? null,
      message: detail.message ?? null
    }));
    return jsonResponse({ error: "Inbjudan kunde inte sparas." }, 500, origin);
  }

  const redirectTo = `${appOrigin}/auth/callback?invitation=${invitationId}`;
  const inviteResponse = await apiFetch(
    `/auth/v1/invite?redirect_to=${encodeURIComponent(redirectTo)}`,
    {
      method: "POST",
      headers: {
        ...adminAuthorization(secretKey),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email })
    },
    secretKey
  );

  let emailResponse = inviteResponse;
  if (inviteResponse.status === 422) {
    emailResponse = await apiFetch(
      `/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, create_user: false })
      },
      publishableKey
    );
  }

  if (!emailResponse.ok) {
    const detail = await emailResponse.json().catch(() => ({})) as {
      code?: string;
      message?: string;
    };
    console.error(JSON.stringify({
      stage: "send_invitation_email",
      status: emailResponse.status,
      code: detail.code ?? null,
      message: detail.message ?? null
    }));
    const deleteQuery = new URLSearchParams({ id: `eq.${invitationId}` });
    await apiFetch(`/rest/v1/organization_invitations?${deleteQuery}`, {
      method: "DELETE",
      headers: adminAuthorization(secretKey)
    }, secretKey);
    return jsonResponse({ error: "Inbjudningsmejlet kunde inte skickas." }, 502, origin);
  }

  return jsonResponse({
    invitation: {
      id: invitationId,
      email,
      role,
      expiresAt
    },
    delivery: "email"
  }, 201, origin);
});
