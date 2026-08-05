import {
  recoverExpiredDemoSession,
  type AnonymousSessionIdentity
} from "./demoSessionLifecycle";
import { acceptsRepeatedTurnstileTestToken } from "./demoTurnstileTestMode";

export interface DemoInstance {
  organizationId: string;
  campId: string;
  expiresAt: string;
  templateVersion: number | null;
  reused: boolean;
}

export interface DemoIdentity extends AnonymousSessionIdentity {
  isAnonymous: boolean;
}

export type DemoRemoteStatus =
  | { state: "active"; instance: DemoInstance }
  | { state: "expired"; expiresAt: string }
  | { state: "missing" }
  | { state: "not_demo" };

export interface DemoStartTokens {
  authCaptchaToken: string;
  provisionCaptchaToken: string;
}

export interface DemoSessionDependencies {
  currentIdentity: () => Promise<DemoIdentity | null>;
  readSessionStatus: () => Promise<DemoRemoteStatus>;
  signInAnonymously: (captchaToken: string) => Promise<DemoIdentity>;
  provisionCurrentSession: (
    action: "start" | "reset",
    captchaToken: string
  ) => Promise<DemoInstance>;
  clearOfflineDataForUser: (userId: string) => Promise<void>;
  clearWorkspaceSelectionsForUser: (userId: string) => void;
  signOutLocal: () => Promise<void>;
  abandonSession: (userId: string) => Promise<void>;
}

export interface EnteredDemoSession {
  userId: string;
  instance: DemoInstance;
}

export interface DemoTurnstilePolicy {
  siteKey: string | null;
  appHostname: string;
}

function validToken(value: string): boolean {
  return value.length > 0 && value.length <= 2_048 && value.trim() === value;
}

function validateTokens(
  tokens: DemoStartTokens,
  turnstilePolicy?: DemoTurnstilePolicy
): void {
  if (
    !validToken(tokens.authCaptchaToken)
    || !validToken(tokens.provisionCaptchaToken)
  ) {
    throw new Error("Robotkontrollen behöver göras om.");
  }
  if (
    tokens.authCaptchaToken === tokens.provisionCaptchaToken
    && !(
      turnstilePolicy
      && acceptsRepeatedTurnstileTestToken(
        tokens.authCaptchaToken,
        tokens.provisionCaptchaToken,
        turnstilePolicy.siteKey,
        turnstilePolicy.appHostname
      )
    )
  ) {
    throw new Error("Robotkontrollerna måste använda två olika engångstoken.");
  }
}

async function createAndProvision(
  tokens: DemoStartTokens,
  dependencies: DemoSessionDependencies
): Promise<EnteredDemoSession> {
  const identity = await dependencies.signInAnonymously(tokens.authCaptchaToken);
  if (!identity.userId || !identity.isAnonymous) {
    if (identity.userId) await dependencies.abandonSession(identity.userId);
    throw new Error("Demoläget kunde inte öppnas med en anonym användare.");
  }

  try {
    const instance = await dependencies.provisionCurrentSession(
      "start",
      tokens.provisionCaptchaToken
    );
    return { userId: identity.userId, instance };
  } catch (error) {
    try {
      await dependencies.abandonSession(identity.userId);
    } catch {
      // The provisioning error remains the useful error. Server-side orphan
      // cleanup is the final safety net if local session abandonment fails.
    }
    throw error;
  }
}

export async function enterDemoSession(
  tokens: DemoStartTokens,
  dependencies: DemoSessionDependencies,
  turnstilePolicy?: DemoTurnstilePolicy
): Promise<EnteredDemoSession> {
  validateTokens(tokens, turnstilePolicy);
  const identity = await dependencies.currentIdentity();

  if (!identity) return createAndProvision(tokens, dependencies);
  if (!identity.isAnonymous) {
    throw new Error("Logga ut från det vanliga kontot innan du öppnar demoläget.");
  }

  const status = await dependencies.readSessionStatus();
  if (status.state === "active") {
    return { userId: identity.userId, instance: status.instance };
  }
  if (status.state === "not_demo") {
    throw new Error("Den aktiva sessionen tillhör inte demoläget.");
  }
  if (status.state === "missing") {
    const instance = await dependencies.provisionCurrentSession(
      "start",
      tokens.provisionCaptchaToken
    );
    return { userId: identity.userId, instance };
  }

  const recovered = await recoverExpiredDemoSession(identity.userId, {
    clearOfflineDataForUser: dependencies.clearOfflineDataForUser,
    clearWorkspaceSelectionsForUser:
      dependencies.clearWorkspaceSelectionsForUser,
    signOutLocal: dependencies.signOutLocal,
    signInAnonymously: async () => {
      const nextIdentity = await dependencies.signInAnonymously(
        tokens.authCaptchaToken
      );
      if (!nextIdentity.isAnonymous) {
        if (nextIdentity.userId) {
          await dependencies.abandonSession(nextIdentity.userId);
        }
        throw new Error("Demoläget kunde inte öppnas med en anonym användare.");
      }
      return nextIdentity;
    },
    provisionCurrentSession: () => dependencies.provisionCurrentSession(
      "start",
      tokens.provisionCaptchaToken
    ),
    abandonNewSession: async () => {
      const current = await dependencies.currentIdentity();
      if (current) await dependencies.abandonSession(current.userId);
    }
  });

  return recovered;
}

export async function resetDemoSession(
  identity: DemoIdentity,
  captchaToken: string,
  dependencies: DemoSessionDependencies
): Promise<EnteredDemoSession> {
  if (!identity.isAnonymous) {
    throw new Error("Bara det egna demolägret kan återställas.");
  }
  if (!validToken(captchaToken)) {
    throw new Error("Robotkontrollen behöver göras om.");
  }

  await dependencies.clearOfflineDataForUser(identity.userId);
  dependencies.clearWorkspaceSelectionsForUser(identity.userId);
  const instance = await dependencies.provisionCurrentSession(
    "reset",
    captchaToken
  );
  return { userId: identity.userId, instance };
}
