import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { clearOfflineDataForUser, countPendingMutations } from "../../lib/offlineDb";
import { supabase, supabaseConfiguration, supabaseConfigured } from "../../lib/supabase";
import {
  provisionDemoInstance,
  readDemoSessionStatus
} from "../demo/demoApi";
import { demoConfiguration } from "../demo/demoConfiguration";
import {
  enterDemoSession,
  resetDemoSession,
  type DemoInstance,
  type DemoSessionDependencies,
  type DemoStartTokens
} from "../demo/demoSessionCoordinator";
import {
  clearWorkspaceSelectionsForUser,
  selectedCampKey,
  selectedOrganizationKey
} from "../workspace/workspaceSelectionStorage";
import { localDevLoginCredentials } from "./localDevLogin";

type AuthStatus = "loading" | "configured" | "unconfigured";
type InvitationStatus = "idle" | "accepting" | "accepted" | "error";

interface InvitationState {
  status: InvitationStatus;
  message: string | null;
}

export type DemoUiStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "starting"
  | "active"
  | "resetting"
  | "expired"
  | "missing"
  | "error";

export interface DemoUiState {
  status: DemoUiStatus;
  instance: DemoInstance | null;
  error: string | null;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  status: AuthStatus;
  automaticSignInError: string | null;
  invitation: InvitationState;
  demoState: DemoUiState;
  requestMagicLink: (email: string) => Promise<void>;
  startDemo: (tokens: DemoStartTokens) => Promise<void>;
  resetDemo: (captchaToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearInvitation: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function invitationIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get("invitation");
}

function removeAuthSecretsFromUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("invitation");
  url.hash = "";
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>(supabaseConfigured ? "loading" : "unconfigured");
  const [automaticSignInError, setAutomaticSignInError] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<InvitationState>(() => ({
    status: invitationIdFromUrl() ? "accepting" : "idle",
    message: null
  }));
  const [demoState, setDemoState] = useState<DemoUiState>(() => ({
    status: demoConfiguration.enabled ? "idle" : "disabled",
    instance: null,
    error: demoConfiguration.error
  }));
  const handledInvitation = useRef<string | null>(null);
  const demoOperation = useRef(false);
  const inspectedDemoUser = useRef<string | null>(null);
  const authenticatedUserId = session?.user.id ?? null;
  const anonymousSession = session?.user.is_anonymous === true;

  useEffect(() => {
    if (!supabase) return;

    let mounted = true;
    const devLogin = localDevLoginCredentials(supabaseConfiguration.isLocal);

    void (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;

      let nextSession = error ? null : data.session;
      if (!nextSession && devLogin) {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword(devLogin);
        if (!mounted) return;
        if (signInError) {
          setAutomaticSignInError(signInError.message);
        } else {
          nextSession = signInData.session;
        }
      }

      setSession(nextSession);
      setStatus("configured");
    })();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setStatus("configured");
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const invitationId = invitationIdFromUrl();
    if (!supabase || !session || !invitationId || handledInvitation.current === invitationId) return;

    handledInvitation.current = invitationId;
    setInvitation({ status: "accepting", message: null });

    void supabase
      .rpc("accept_organization_invitation", { invitation_id: invitationId })
      .then(({ error }) => {
        removeAuthSecretsFromUrl();
        setInvitation(error
          ? { status: "error", message: error.message }
          : { status: "accepted", message: "Inbjudan är accepterad och organisationen är tillagd." });
      });
  }, [session]);

  const requestMagicLink = useCallback(async (email: string) => {
    if (!supabase) throw new Error("Auth-klienten är inte konfigurerad.");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/`
      }
    });
    if (error) throw error;
  }, []);

  const activateDemoInstance = useCallback(async (
    userId: string,
    instance: DemoInstance
  ) => {
    window.localStorage.setItem(
      selectedOrganizationKey(userId),
      instance.organizationId
    );
    window.localStorage.setItem(
      selectedCampKey(userId, instance.organizationId),
      instance.campId
    );
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["organization-memberships", userId]
      }),
      queryClient.invalidateQueries({
        queryKey: ["camps", userId, instance.organizationId]
      })
    ]);
  }, [queryClient]);

  const demoDependencies = useMemo<DemoSessionDependencies | null>(() => {
    if (!supabase) return null;
    const demoClient = supabase;

    async function signOutLocal(): Promise<void> {
      const { error } = await demoClient.auth.signOut({ scope: "local" });
      if (error) throw error;
    }

    return {
      currentIdentity: async () => {
        const { data, error } = await demoClient.auth.getSession();
        if (error) throw error;
        const user = data.session?.user;
        return user
          ? { userId: user.id, isAnonymous: user.is_anonymous === true }
          : null;
      },
      readSessionStatus: () => readDemoSessionStatus(demoClient),
      signInAnonymously: async (captchaToken) => {
        const { data, error } = await demoClient.auth.signInAnonymously({
          options: { captchaToken }
        });
        if (error || !data.user || !data.session) {
          throw error ?? new Error("En anonym session kunde inte skapas.");
        }
        return {
          userId: data.user.id,
          isAnonymous: data.user.is_anonymous === true
        };
      },
      provisionCurrentSession: (action, captchaToken) =>
        provisionDemoInstance(demoClient, action, captchaToken),
      clearOfflineDataForUser,
      clearWorkspaceSelectionsForUser,
      signOutLocal,
      abandonSession: async (userId) => {
        await clearOfflineDataForUser(userId);
        clearWorkspaceSelectionsForUser(userId);
        await signOutLocal();
      }
    };
  }, []);

  useEffect(() => {
    if (!authenticatedUserId || !anonymousSession) {
      inspectedDemoUser.current = null;
      return;
    }
    if (!demoConfiguration.enabled || !demoDependencies) {
      return;
    }
    if (
      demoOperation.current
      || inspectedDemoUser.current === authenticatedUserId
    ) {
      return;
    }

    inspectedDemoUser.current = authenticatedUserId;
    let cancelled = false;
    setDemoState({ status: "checking", instance: null, error: null });
    void demoDependencies.readSessionStatus()
      .then(async (remoteStatus) => {
        if (cancelled) return;
        if (remoteStatus.state === "active") {
          await activateDemoInstance(
            authenticatedUserId,
            remoteStatus.instance
          );
          if (!cancelled) {
            setDemoState({
              status: "active",
              instance: remoteStatus.instance,
              error: null
            });
          }
          return;
        }
        if (remoteStatus.state === "not_demo") {
          await demoDependencies.abandonSession(authenticatedUserId);
          inspectedDemoUser.current = null;
          if (!cancelled) {
            setDemoState({
              status: "idle",
              instance: null,
              error: null
            });
          }
          return;
        }
        setDemoState({
          status: remoteStatus.state === "expired"
            ? "expired"
            : "missing",
          instance: null,
          error: null
        });
      })
      .catch((caught) => {
        if (!cancelled) {
          setDemoState({
            status: "error",
            instance: null,
            error: caught instanceof Error
              ? caught.message
              : "Demoläget kunde inte kontrolleras."
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    activateDemoInstance,
    anonymousSession,
    authenticatedUserId,
    demoDependencies,
  ]);

  useEffect(() => {
    const expiresAt = demoState.instance?.expiresAt;
    if (
      !expiresAt
      || (demoState.status !== "active" && demoState.status !== "resetting")
    ) {
      return;
    }
    const delay = Math.max(0, Date.parse(expiresAt) - Date.now());
    const timer = window.setTimeout(() => {
      setDemoState((current) =>
        current.instance?.expiresAt === expiresAt
          ? { status: "expired", instance: null, error: null }
          : current
      );
    }, delay);
    return () => window.clearTimeout(timer);
  }, [demoState.instance?.expiresAt, demoState.status]);

  const startDemo = useCallback(async (tokens: DemoStartTokens) => {
    if (!demoConfiguration.enabled || !demoDependencies) {
      throw new Error(
        demoConfiguration.error ?? "Demoläget är inte tillgängligt."
      );
    }
    if (demoOperation.current) {
      throw new Error("Demolägret håller redan på att förberedas.");
    }

    demoOperation.current = true;
    setDemoState({ status: "starting", instance: null, error: null });
    try {
      const entered = await enterDemoSession(tokens, demoDependencies, {
        siteKey: demoConfiguration.siteKey,
        appHostname: window.location.hostname
      });
      await activateDemoInstance(entered.userId, entered.instance);
      inspectedDemoUser.current = entered.userId;
      setDemoState({
        status: "active",
        instance: entered.instance,
        error: null
      });
    } catch (caught) {
      const message = caught instanceof Error
        ? caught.message
        : "Demolägret kunde inte öppnas. Försök igen.";
      setDemoState({ status: "error", instance: null, error: message });
      throw caught;
    } finally {
      demoOperation.current = false;
    }
  }, [activateDemoInstance, demoDependencies]);

  const resetDemo = useCallback(async (captchaToken: string) => {
    if (!demoDependencies) throw new Error("Demoläget är inte tillgängligt.");
    if (demoOperation.current) {
      throw new Error("Demolägret håller redan på att ändras.");
    }

    const current = await demoDependencies.currentIdentity();
    if (!current) throw new Error("Demolägret saknas.");
    const previousInstance = demoState.instance;
    demoOperation.current = true;
    setDemoState({
      status: "resetting",
      instance: previousInstance,
      error: null
    });
    try {
      const entered = await resetDemoSession(
        current,
        captchaToken,
        demoDependencies
      );
      await activateDemoInstance(entered.userId, entered.instance);
      inspectedDemoUser.current = entered.userId;
      setDemoState({
        status: "active",
        instance: entered.instance,
        error: null
      });
    } catch (caught) {
      const message = caught instanceof Error
        ? caught.message
        : "Demolägret kunde inte återställas. Försök igen.";
      try {
        const remoteStatus = await demoDependencies.readSessionStatus();
        if (remoteStatus.state === "active") {
          await activateDemoInstance(current.userId, remoteStatus.instance);
          setDemoState({
            status: "active",
            instance: remoteStatus.instance,
            error: message
          });
        } else {
          setDemoState({
            status: remoteStatus.state === "expired" ? "expired" : "missing",
            instance: null,
            error: message
          });
        }
      } catch {
        setDemoState({ status: "error", instance: null, error: message });
      }
      throw caught;
    } finally {
      demoOperation.current = false;
    }
  }, [
    activateDemoInstance,
    demoDependencies,
    demoState.instance
  ]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    const userId = session?.user.id;
    if (userId) {
      const pendingCount = await countPendingMutations(userId);
      if (pendingCount > 0) {
        const confirmed = window.confirm(
          `${pendingCount} ändring${pendingCount === 1 ? "" : "ar"} har inte synkroniserats. `
          + "Om du loggar ut raderas de från den här enheten. Vill du fortsätta?"
        );
        if (!confirmed) return;
      }
    }
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    if (userId) {
      await clearOfflineDataForUser(userId);
      if (session?.user.is_anonymous) {
        clearWorkspaceSelectionsForUser(userId);
      }
    }
    inspectedDemoUser.current = null;
    setDemoState({
      status: demoConfiguration.enabled ? "idle" : "disabled",
      instance: null,
      error: demoConfiguration.error
    });
  }, [session?.user.id, session?.user.is_anonymous]);

  const clearInvitation = useCallback(() => {
    setInvitation({ status: "idle", message: null });
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    user: session?.user ?? null,
    status,
    automaticSignInError,
    invitation,
    demoState,
    requestMagicLink,
    startDemo,
    resetDemo,
    signOut,
    clearInvitation
  }), [
    automaticSignInError,
    clearInvitation,
    demoState,
    invitation,
    requestMagicLink,
    resetDemo,
    session,
    signOut,
    startDemo,
    status
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Context hooks intentionally share this module with their provider.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth måste användas inuti AuthProvider.");
  return context;
}
