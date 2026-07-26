import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState
} from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import {
  cacheCamps,
  cacheMemberships,
  readCachedCamps,
  readCachedMemberships
} from "./workspaceCache";

export type OrganizationRole = "admin" | "planner";

export interface OrganizationMembership {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: OrganizationRole;
}

export interface CampSummary {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  timezone: string;
}

export interface CreateCampInput {
  name: string;
  startsOn: string;
  endsOn: string;
  timezone: string;
}

interface WorkspaceContextValue {
  memberships: OrganizationMembership[];
  camps: CampSummary[];
  activeMembership: OrganizationMembership | null;
  activeCamp: CampSummary | null;
  setActiveOrganizationId: (id: string) => void;
  setActiveCampId: (id: string) => void;
  createCamp: (input: CreateCampInput) => Promise<string>;
  loading: boolean;
  error: string | null;
}

interface MembershipQueryRow {
  organization_id: string;
  role: OrganizationRole;
  organizations: { id: string; name: string; slug: string } | Array<{ id: string; name: string; slug: string }>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function selectedOrganizationKey(userId: string): string {
  return `lagermat:selected-organization:${userId}`;
}

function selectedCampKey(userId: string, organizationId: string): string {
  return `lagermat:selected-camp:${userId}:${organizationId}`;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [activeOrganizationId, setActiveOrganizationIdState] = useState<string | null>(null);
  const [activeCampId, setActiveCampIdState] = useState<string | null>(null);

  const membershipsQuery = useQuery({
    queryKey: ["organization-memberships", user?.id],
    enabled: Boolean(user && supabase),
    networkMode: "always",
    retry: false,
    queryFn: async () => {
      if (!supabase || !user) return [];
      if (!navigator.onLine) {
        const cached = await readCachedMemberships(user.id);
        if (cached.length > 0) return cached;
        throw new Error("Ingen organisationscache finns för offlinearbete ännu.");
      }
      try {
        const { data, error } = await supabase
          .from("organization_memberships")
          .select("organization_id, role, organizations!inner(id, name, slug)")
          .eq("user_id", user.id)
          .eq("status", "active")
          .order("created_at");
        if (error) throw error;

        const memberships = (data as unknown as MembershipQueryRow[]).map((row) => {
          const organization = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
          if (!organization) throw new Error("Ett medlemskap saknar organisation.");
          return {
            organizationId: organization.id,
            organizationName: organization.name,
            organizationSlug: organization.slug,
            role: row.role
          } satisfies OrganizationMembership;
        });
        await cacheMemberships(user.id, memberships);
        return memberships;
      } catch (error) {
        const cached = await readCachedMemberships(user.id);
        if (cached.length > 0) return cached;
        throw error;
      }
    }
  });

  const memberships = useMemo(() => membershipsQuery.data ?? [], [membershipsQuery.data]);
  const storedOrganizationId = user
    ? window.localStorage.getItem(selectedOrganizationKey(user.id))
    : null;
  const resolvedOrganizationId = memberships.some((membership) => membership.organizationId === activeOrganizationId)
    ? activeOrganizationId
    : memberships.some((membership) => membership.organizationId === storedOrganizationId)
      ? storedOrganizationId
      : memberships[0]?.organizationId ?? null;

  const campsQuery = useQuery({
    queryKey: ["camps", user?.id, resolvedOrganizationId],
    enabled: Boolean(user && resolvedOrganizationId && supabase),
    networkMode: "always",
    retry: false,
    queryFn: async () => {
      if (!supabase || !resolvedOrganizationId || !user) return [];
      if (!navigator.onLine) {
        const cached = await readCachedCamps(user.id, resolvedOrganizationId);
        if (cached.length > 0) return cached;
        throw new Error("Ingen lägercache finns för offlinearbete ännu.");
      }
      try {
        const { data, error } = await supabase
          .from("camps")
          .select("id, name, starts_on, ends_on, timezone")
          .eq("organization_id", resolvedOrganizationId)
          .order("starts_on", { ascending: false });
        if (error) throw error;
        const camps = data.map((camp) => ({
          id: camp.id,
          name: camp.name,
          startsOn: camp.starts_on,
          endsOn: camp.ends_on,
          timezone: camp.timezone
        }));
        await cacheCamps(user.id, resolvedOrganizationId, camps);
        return camps;
      } catch (error) {
        const cached = await readCachedCamps(user.id, resolvedOrganizationId);
        if (cached.length > 0) return cached;
        throw error;
      }
    }
  });

  const camps = useMemo(() => campsQuery.data ?? [], [campsQuery.data]);
  const storedCampId = user && resolvedOrganizationId
    ? window.localStorage.getItem(selectedCampKey(user.id, resolvedOrganizationId))
    : null;
  const resolvedCampId = camps.some((camp) => camp.id === activeCampId)
    ? activeCampId
    : camps.some((camp) => camp.id === storedCampId)
      ? storedCampId
      : camps[0]?.id ?? null;

  function setActiveOrganizationId(id: string) {
    setActiveOrganizationIdState(id);
    setActiveCampIdState(null);
    if (user) window.localStorage.setItem(selectedOrganizationKey(user.id), id);
  }

  function setActiveCampId(id: string) {
    setActiveCampIdState(id);
    if (user && resolvedOrganizationId) {
      window.localStorage.setItem(selectedCampKey(user.id, resolvedOrganizationId), id);
    }
  }

  const createCamp = useCallback(async (input: CreateCampInput): Promise<string> => {
    if (!supabase || !user || !resolvedOrganizationId) {
      throw new Error("Ingen aktiv organisation finns för det nya lägret.");
    }

    const { data, error: createError } = await supabase.rpc("create_camp", {
      p_organization_id: resolvedOrganizationId,
      p_name: input.name,
      p_starts_on: input.startsOn,
      p_ends_on: input.endsOn,
      p_timezone: input.timezone
    });
    if (createError) throw createError;
    if (typeof data !== "string") throw new Error("Databasen returnerade inget läger-id.");

    await queryClient.invalidateQueries({
      queryKey: ["camps", user.id, resolvedOrganizationId]
    });
    setActiveCampIdState(data);
    window.localStorage.setItem(selectedCampKey(user.id, resolvedOrganizationId), data);
    return data;
  }, [queryClient, resolvedOrganizationId, user]);

  const activeMembership = memberships.find((membership) => membership.organizationId === resolvedOrganizationId) ?? null;
  const activeCamp = camps.find((camp) => camp.id === resolvedCampId) ?? null;
  const error = membershipsQuery.error ?? campsQuery.error;

  const value: WorkspaceContextValue = {
    memberships,
    camps,
    activeMembership,
    activeCamp,
    setActiveOrganizationId,
    setActiveCampId,
    createCamp,
    loading: membershipsQuery.isLoading || campsQuery.isLoading,
    error: error instanceof Error ? error.message : null
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

// Context hooks intentionally share this module with their provider.
// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace måste användas inuti WorkspaceProvider.");
  return context;
}
