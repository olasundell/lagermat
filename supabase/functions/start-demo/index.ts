import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import {
  createStartDemoHandler,
  createTurnstileValidator,
  startDemoTransportGuard,
  type DemoProvisionResult,
} from "./handler.ts";

interface ProvisionRow {
  organization_id?: unknown;
  camp_id?: unknown;
  expires_at?: unknown;
  template_version?: unknown;
  reused?: unknown;
}

const authenticatedFetch = withSupabase(
  { auth: "user" },
  async (request, context) => {
    const environment = {
      appOrigin: Deno.env.get("APP_ORIGIN"),
      demoMode: Deno.env.get("DEMO_MODE"),
      turnstileSecretKey: Deno.env.get("TURNSTILE_SECRET_KEY"),
    };
    let turnstileValidator:
      | ReturnType<typeof createTurnstileValidator>
      | undefined;

    const handler = createStartDemoHandler({
      getEnvironment: () => environment,
      authenticate: async (accessToken) => {
        const { data, error } = await context.supabaseAdmin.auth.getUser(
          accessToken,
        );
        if (error || !data.user) return null;
        return {
          id: data.user.id,
          isAnonymous: data.user.is_anonymous === true,
        };
      },
      verifyTurnstile: async (input) => {
        turnstileValidator ??= createTurnstileValidator({
          secretKey: environment.turnstileSecretKey ?? "",
        });
        return turnstileValidator(input);
      },
      provision: async ({ userId, reset }) => {
        const { data, error } = await context.supabaseAdmin.rpc(
          "provision_demo_instance",
          {
            p_user_id: userId,
            p_reset: reset,
          },
        );
        if (error) throw new Error("Demo provisioning RPC failed");

        const row = (Array.isArray(data) ? data[0] : null) as
          | ProvisionRow
          | null;
        return {
          organizationId: row?.organization_id,
          campId: row?.camp_id,
          expiresAt: row?.expires_at,
          templateVersion: row?.template_version,
          reused: row?.reused,
        } as DemoProvisionResult;
      },
    });

    // `withSupabase` authenticates the JWT at the function boundary. The
    // handler deliberately validates the same token against the persisted Auth
    // user once more so `is_anonymous` is never trusted from client metadata.
    return handler(request);
  },
);

export default {
  fetch: async (request: Request): Promise<Response> => {
    const transportResponse = startDemoTransportGuard(
      request,
      Deno.env.get("APP_ORIGIN"),
    );
    if (transportResponse) return transportResponse;
    return authenticatedFetch(request);
  },
};
