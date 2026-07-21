import type { Session, User } from "@supabase/supabase-js";
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
import { supabase, supabaseConfigured } from "../../lib/supabase";

type AuthStatus = "loading" | "configured" | "unconfigured";
type InvitationStatus = "idle" | "accepting" | "accepted" | "error";

interface InvitationState {
  status: InvitationStatus;
  message: string | null;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  status: AuthStatus;
  invitation: InvitationState;
  requestMagicLink: (email: string) => Promise<void>;
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
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>(supabaseConfigured ? "loading" : "unconfigured");
  const [invitation, setInvitation] = useState<InvitationState>(() => ({
    status: invitationIdFromUrl() ? "accepting" : "idle",
    message: null
  }));
  const handledInvitation = useRef<string | null>(null);

  useEffect(() => {
    if (!supabase) return;

    let mounted = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      setSession(error ? null : data.session);
      setStatus("configured");
    });

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
    if (userId) await clearOfflineDataForUser(userId);
  }, [session?.user.id]);

  const clearInvitation = useCallback(() => {
    setInvitation({ status: "idle", message: null });
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    user: session?.user ?? null,
    status,
    invitation,
    requestMagicLink,
    signOut,
    clearInvitation
  }), [clearInvitation, invitation, requestMagicLink, session, signOut, status]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Context hooks intentionally share this module with their provider.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth måste användas inuti AuthProvider.");
  return context;
}
