import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MailPlus, ShieldCheck, UsersRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button, Input, Label, Select, SelectValue, ListBox, ListBoxItem, Popover, TextField } from "react-aria-components";
import { supabase } from "../../lib/supabase";
import type { Enums } from "../../types/database";
import { useAuth } from "../auth/AuthContext";
import { useWorkspace } from "../workspace/WorkspaceContext";
import { AdminMfaGate } from "./AdminMfaGate";

type OrganizationRole = Enums<"organization_role">;

interface OrganizationMember {
  user_id: string;
  email: string;
  display_name: string;
  role: OrganizationRole;
  status: "active" | "suspended";
}

const roleLabels: Record<OrganizationRole, string> = {
  admin: "Administratör",
  planner: "Planerare"
};
const roleOptions = Object.entries(roleLabels).map(([id, label]) => ({ id, label }));

async function invitationErrorMessage(error: Error): Promise<string> {
  const context = (error as Error & { context?: Response }).context;
  if (!context) return error.message;
  const body = await context.clone().json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : error.message;
}

export function TeamPage() {
  const { user } = useAuth();
  const { activeMembership } = useWorkspace();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrganizationRole>("planner");
  const [success, setSuccess] = useState<string | null>(null);
  const organizationId = activeMembership?.organizationId ?? null;
  const isAdmin = activeMembership?.role === "admin";
  const assuranceQuery = useQuery({
    queryKey: ["auth-assurance-level", user?.id],
    enabled: Boolean(supabase && user && isAdmin),
    queryFn: async () => {
      if (!supabase) return null;
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) throw error;
      return data;
    }
  });
  const hasAdminAssurance = assuranceQuery.data?.currentLevel === "aal2";

  const membersQuery = useQuery({
    queryKey: ["organization-members", organizationId],
    enabled: Boolean(supabase && organizationId && isAdmin && hasAdminAssurance),
    queryFn: async () => {
      if (!supabase || !organizationId) return [];
      const { data, error } = await supabase.rpc("list_organization_members", {
        target_organization_id: organizationId
      });
      if (error) throw error;
      return data as OrganizationMember[];
    }
  });

  const invitationsQuery = useQuery({
    queryKey: ["organization-invitations", organizationId],
    enabled: Boolean(supabase && organizationId && isAdmin && hasAdminAssurance),
    queryFn: async () => {
      if (!supabase || !organizationId) return [];
      const { data, error } = await supabase
        .from("organization_invitations")
        .select("id, email, role, expires_at, accepted_at")
        .eq("organization_id", organizationId)
        .is("accepted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    }
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      if (!supabase || !organizationId) throw new Error("Ingen aktiv organisation.");
      const { error } = await supabase.functions.invoke("invite-member", {
        body: { organizationId, email, role }
      });
      if (error) throw new Error(await invitationErrorMessage(error));
    },
    onSuccess: async () => {
      setSuccess(`Inbjudan har skickats till ${email.trim().toLowerCase()}.`);
      setEmail("");
      await queryClient.invalidateQueries({ queryKey: ["organization-invitations", organizationId] });
    }
  });

  const roleMutation = useMutation({
    mutationFn: async ({ memberId, nextRole }: { memberId: string; nextRole: OrganizationRole }) => {
      if (!supabase || !organizationId) throw new Error("Ingen aktiv organisation.");
      const { error } = await supabase.rpc("change_member_role", {
        p_organization_id: organizationId,
        p_member_user_id: memberId,
        p_role: nextRole
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["organization-members", organizationId] });
    }
  });

  function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSuccess(null);
    inviteMutation.reset();
    inviteMutation.mutate();
  }

  if (!activeMembership) {
    return (
      <div className="page page--narrow">
        <div className="empty-panel"><h1>Ingen aktiv organisation</h1><p>Välj eller acceptera en organisation innan teamet kan hanteras.</p></div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="page page--narrow">
        <div className="empty-panel">
          <div className="empty-panel__icon"><ShieldCheck aria-hidden="true" /></div>
          <h1>Administratör krävs</h1>
          <p>Planerare kan arbeta med lägerinnehåll men inte se e-postadresser, bjuda in medlemmar eller ändra roller.</p>
        </div>
      </div>
    );
  }

  if (assuranceQuery.isLoading || !hasAdminAssurance) {
    return <AdminMfaGate onVerified={() => assuranceQuery.refetch()} />;
  }

  return (
    <div className="page page--narrow team-page">
      <header className="page-heading">
        <p className="page-heading__eyebrow">{activeMembership.organizationName}</p>
        <h1>Användare och behörigheter</h1>
        <p>Inbjudningslänken skickas med e-post, gäller i 24 timmar och kan användas en gång.</p>
      </header>

      <section className="team-card" aria-labelledby="invite-heading">
        <div className="team-card__heading">
          <MailPlus aria-hidden="true" size={24} />
          <div><h2 id="invite-heading">Bjud in användare</h2><p>Användaren får en personlig engångslänk via e-post.</p></div>
        </div>
        <form className="invite-form" onSubmit={handleInvite}>
          <TextField name="invite-email" type="email" isRequired value={email} onChange={setEmail}>
            <Label>E-postadress</Label>
              <Input placeholder="namn@exempel.se" />
          </TextField>
          <div className="select-field">
            <Label id="invite-role-label">Roll</Label>
            <Select name="invite-role" className="team-role-select" aria-labelledby="invite-role-label" selectedKey={role} onSelectionChange={(key) => setRole(String(key) as OrganizationRole)}>
              <Button className="team-role-select__button"><SelectValue /></Button>
              <Popover className="team-role-select__popover">
                <ListBox className="team-role-select__list" items={roleOptions}>
                  {(option) => <ListBoxItem className="team-role-select__option" id={option.id}>{option.label}</ListBoxItem>}
                </ListBox>
              </Popover>
            </Select>
          </div>
          <Button className="primary-button" type="submit" isDisabled={inviteMutation.isPending}>Skicka inbjudan</Button>
        </form>
        {inviteMutation.error ? <p className="form-error" role="alert">{inviteMutation.error.message}</p> : null}
        {success ? <p className="form-success" role="status">{success}</p> : null}
      </section>

      <section className="team-card" aria-labelledby="members-heading">
        <div className="team-card__heading">
          <UsersRound aria-hidden="true" size={24} />
          <div><h2 id="members-heading">Medlemmar</h2><p>Administratörer hanterar organisationen; planerare hanterar lägerinnehåll.</p></div>
        </div>
        {membersQuery.error ? <p className="form-error" role="alert">{membersQuery.error.message}</p> : null}
        <div className="member-list">
          {(membersQuery.data ?? []).map((member) => (
            <div className="member-row" key={member.user_id}>
              <span className="member-avatar" aria-hidden="true">{member.display_name.slice(0, 2).toUpperCase()}</span>
              <span className="member-identity"><strong>{member.display_name}</strong><small>{member.email}</small></span>
              <select
                name={`member-role-${member.user_id}`}
                aria-label={`Roll för ${member.display_name}`}
                value={member.role}
                disabled={member.user_id === user?.id || roleMutation.isPending}
                onChange={(event) => roleMutation.mutate({ memberId: member.user_id, nextRole: event.target.value as OrganizationRole })}
              >
                <option value="admin">Administratör</option>
                <option value="planner">Planerare</option>
              </select>
            </div>
          ))}
        </div>
      </section>

      {(invitationsQuery.data ?? []).length > 0 ? (
        <section className="team-card" aria-labelledby="pending-heading">
          <div className="team-card__heading"><MailPlus aria-hidden="true" size={24} /><div><h2 id="pending-heading">Väntande inbjudningar</h2></div></div>
          <div className="pending-list">
            {(invitationsQuery.data ?? []).map((invitation) => (
              <div key={invitation.id}><span>{invitation.email}</span><span>{roleLabels[invitation.role]}</span><time dateTime={invitation.expires_at}>{new Date(invitation.expires_at).toLocaleString("sv-SE")}</time></div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
