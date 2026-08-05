import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, CircleAlert, LoaderCircle, Plus, ShieldAlert, Tags } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "react-aria-components";
import { supabase } from "../../lib/supabase";
import { userFacingError } from "../../lib/userFacingError";
import { useWorkspace } from "../workspace/WorkspaceContext";
import { dietaryTagDisplayLabel, normalizeSelectedTags, suggestDietaryTags } from "./dietarySuggestions";
import { specialDietSummary } from "./specialDietSummary";

interface DietaryNeedRow {
  id: string;
  participant_id: string;
  raw_food_note: string | null;
  review_status: "unreviewed" | "reviewed" | "resolved";
  reviewed_at: string | null;
}

interface ParticipantIdentity {
  id: string;
  display_name: string;
  lifecycle_status: "active" | "withdrawn";
}

interface DietaryTagRow {
  id: string;
  label: string;
}

interface NeedTagRow {
  dietary_need_id: string;
  dietary_tag_id: string;
}

interface ReviewCardProps {
  need: DietaryNeedRow;
  participantName: string;
  tutorialTarget: boolean;
  availableTags: string[];
  currentTags: string[];
  saving: boolean;
  onReview: (needId: string, tags: string[]) => Promise<void>;
}

function ReviewCard({ need, participantName, tutorialTarget, availableTags, currentTags, saving, onReview }: ReviewCardProps) {
  const suggested = useMemo(() => suggestDietaryTags(need.raw_food_note), [need.raw_food_note]);
  const [selected, setSelected] = useState<string[]>(() => normalizeSelectedTags([...currentTags, ...suggested]));
  const [customTag, setCustomTag] = useState("");
  const choices = normalizeSelectedTags([...availableTags, ...suggested, ...selected]);

  function toggle(label: string, checked: boolean) {
    setSelected((tags) => normalizeSelectedTags(checked ? [...tags, label] : tags.filter((tag) => tag !== label)));
  }

  function addCustomTag() {
    const normalized = normalizeSelectedTags([...selected, customTag]);
    if (normalized.length === selected.length) return;
    setSelected(normalized);
    setCustomTag("");
  }

  return (
    <article
      className="diet-card"
      data-tutorial-id={tutorialTarget ? "diets-decision-card" : undefined}
    >
      <header className="diet-card__heading">
        <div><strong>{participantName}</strong><span>{need.review_status === "resolved" ? "Granskad" : "Behöver granskas"}</span></div>
        {need.review_status === "resolved" ? <Check aria-label="Granskad" size={22} /> : <CircleAlert aria-label="Behöver granskas" size={22} />}
      </header>
      <div className="raw-food-note">
        <span>Uppgift från anmälan</span>
        <blockquote>{need.raw_food_note || "Ingen uppgift angiven"}</blockquote>
      </div>
      <div className="diet-proposal">
        <div className="diet-proposal__heading"><Tags aria-hidden="true" size={18} /><strong>Förslag på specialkost – kontrollera innan du sparar</strong></div>
        {choices.length === 0 ? <p className="diet-no-suggestion">Inget tydligt förslag hittades. Lägg till specialkosten själv eller markera att uppgiften inte påverkar maten.</p> : (
          <div className="tag-options">
            {choices.map((label) => (
              <label key={label} className={selected.includes(label) ? "tag-option is-selected" : "tag-option"}>
                <input type="checkbox" name={`specialkost-${need.id}`} value={label} checked={selected.includes(label)} onChange={(event) => toggle(label, event.target.checked)} />
                <span>{dietaryTagDisplayLabel(label)}</span>
              </label>
            ))}
          </div>
        )}
        <div className="custom-tag-row">
          <label><span className="sr-only">Annan specialkost för {participantName}</span><input name={`annan-specialkost-${need.id}`} value={customTag} maxLength={80} placeholder="Till exempel sesam…" onChange={(event) => setCustomTag(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCustomTag(); } }} /></label>
          <Button className="secondary-button" onPress={addCustomTag} isDisabled={!customTag.trim()}><Plus aria-hidden="true" size={17} /> Lägg till</Button>
        </div>
      </div>
      {need.review_status !== "resolved" ? (
        <footer className="diet-card__actions">
          <Button className="text-button" onPress={() => onReview(need.id, [])} isDisabled={saving}>Påverkar inte maten</Button>
          <Button className="primary-button" onPress={() => onReview(need.id, selected)} isDisabled={saving || selected.length === 0}>
            {saving ? <LoaderCircle className="spin" aria-hidden="true" size={18} /> : <Check aria-hidden="true" size={18} />}
            Spara specialkost
          </Button>
        </footer>
      ) : <p className="diet-reviewed-note">Granskad {need.reviewed_at ? new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(need.reviewed_at)) : "lokalt"}.</p>}
    </article>
  );
}

export function SpecialDietsPage() {
  const queryClient = useQueryClient();
  const { activeCamp, activeMembership } = useWorkspace();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scope = activeCamp && activeMembership ? { organizationId: activeMembership.organizationId, campId: activeCamp.id } : null;

  const dietQuery = useQuery({
    queryKey: ["special-diets", scope?.organizationId, scope?.campId],
    enabled: Boolean(scope && supabase),
    queryFn: async () => {
      if (!scope || !supabase) return { needs: [], participants: [], tags: [], links: [], readiness: null };
      const [needsResult, participantsResult, tagsResult, linksResult, readinessResult] = await Promise.all([
        supabase.from("participant_dietary_needs").select("id, participant_id, raw_food_note, review_status, reviewed_at").eq("organization_id", scope.organizationId).eq("camp_id", scope.campId).order("created_at"),
        supabase.from("participants").select("id, display_name, lifecycle_status").eq("organization_id", scope.organizationId).eq("camp_id", scope.campId).eq("lifecycle_status", "active"),
        supabase.from("dietary_tags").select("id, label").eq("organization_id", scope.organizationId).eq("camp_id", scope.campId).order("label"),
        supabase.from("dietary_need_tags").select("dietary_need_id, dietary_tag_id").eq("organization_id", scope.organizationId).eq("camp_id", scope.campId).eq("active", true),
        supabase.rpc("get_camp_readiness", { p_organization_id: scope.organizationId, p_camp_id: scope.campId }).maybeSingle()
      ]);
      const queryError = needsResult.error ?? participantsResult.error ?? tagsResult.error ?? linksResult.error ?? readinessResult.error;
      if (queryError) throw queryError;
      return {
        needs: (needsResult.data ?? []) as DietaryNeedRow[],
        participants: (participantsResult.data ?? []) as ParticipantIdentity[],
        tags: (tagsResult.data ?? []) as DietaryTagRow[],
        links: (linksResult.data ?? []) as NeedTagRow[],
        readiness: readinessResult.data
      };
    }
  });

  const activeParticipantIds = new Set((dietQuery.data?.participants ?? []).map((participant) => participant.id));
  const activeNeeds = (dietQuery.data?.needs ?? []).filter((need) => activeParticipantIds.has(need.participant_id));
  const participantNames = new Map((dietQuery.data?.participants ?? []).map((participant) => [participant.id, participant.display_name]));
  const tagLabels = new Map((dietQuery.data?.tags ?? []).map((tag) => [tag.id, tag.label]));
  const availableTags = (dietQuery.data?.tags ?? []).map((tag) => tag.label);
  const unresolved = activeNeeds.filter((need) => need.review_status !== "resolved");
  const resolved = activeNeeds.filter((need) => need.review_status === "resolved");
  const totalNeeds = unresolved.length + resolved.length;
  const summary = specialDietSummary(totalNeeds, unresolved.length, Boolean(dietQuery.data?.readiness?.calculation_stale));

  function currentTags(needId: string): string[] {
    return (dietQuery.data?.links ?? [])
      .filter((link) => link.dietary_need_id === needId)
      .map((link) => tagLabels.get(link.dietary_tag_id))
      .filter((label): label is string => Boolean(label));
  }

  async function reviewNeed(needId: string, labels: string[]) {
    if (!supabase) return;
    setSavingId(needId);
    setError(null);
    const { error: reviewError } = await supabase.rpc("review_dietary_need", { p_dietary_need_id: needId, p_tag_labels: normalizeSelectedTags(labels) });
    if (reviewError) {
      setError(userFacingError(reviewError, "Specialkosten kunde inte sparas."));
      setSavingId(null);
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["special-diets"] }),
      queryClient.invalidateQueries({ queryKey: ["overview"] })
    ]);
    setSavingId(null);
  }

  if (!scope || !activeCamp) return <section className="page page--narrow"><p className="form-error">Välj organisation och läger först.</p></section>;

  return (
    <section className="page diets-page" data-tutorial-id="diets-page">
      <header
        className="page-heading page-heading--split"
        data-tutorial-id="diets-heading"
      >
        <div><p className="page-heading__eyebrow">Kontroll före inköp</p><h1>Specialkost</h1><p>{activeCamp.name} · kontrollera uppgifterna från anmälan innan du räknar ut mängderna.</p></div>
        <div className={`diet-gate-status${summary.kind === "clear" ? " diet-gate-status--clear" : summary.kind === "empty" ? " diet-gate-status--neutral" : ""}`}>
          {summary.kind === "clear" ? <Check aria-hidden="true" size={22} /> : summary.kind === "empty" ? <Tags aria-hidden="true" size={22} /> : <ShieldAlert aria-hidden="true" size={22} />}
          <span><strong>{summary.heading}</strong><small>{summary.detail}</small></span>
        </div>
      </header>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {dietQuery.isLoading ? <LoaderCircle className="spin" aria-label="Läser specialkost" size={30} /> : dietQuery.error ? <p className="form-error">{userFacingError(dietQuery.error, "Specialkosten kunde inte läsas.")}</p> : (
        <div className="diet-layout">
          <section
            aria-labelledby="diet-review-heading"
            data-tutorial-id="diets-review"
          >
            <div className="section-heading" data-tutorial-id="diets-review-heading"><CircleAlert aria-hidden="true" size={24} /><div><h2 id="diet-review-heading">Att granska</h2><p>Förslag är stöd, aldrig automatiska medicinska beslut.</p></div></div>
            {unresolved.length === 0 ? <div className={`diet-empty${summary.kind === "empty" ? " diet-empty--neutral" : ""}`}>{summary.kind === "empty" ? <Tags aria-hidden="true" size={28} /> : <Check aria-hidden="true" size={28} />}<p>{summary.reviewMessage}</p>{summary.nextStep ? <Link className="primary-button" to={summary.nextStep.to}>{summary.nextStep.label}</Link> : null}</div> : <div className="diet-card-list">{unresolved.map((need, index) => <ReviewCard key={need.id} need={need} participantName={participantNames.get(need.participant_id) ?? "Okänd deltagare"} tutorialTarget={index === 0} availableTags={availableTags} currentTags={currentTags(need.id)} saving={savingId === need.id} onReview={reviewNeed} />)}</div>}
          </section>
          <aside
            aria-labelledby="reviewed-diets-heading"
            data-tutorial-id="diets-decision"
          >
            <div className="section-heading" data-tutorial-id="diets-decision-heading"><Tags aria-hidden="true" size={24} /><div><h2 id="reviewed-diets-heading">Granskade</h2><p>{resolved.length} {resolved.length === 1 ? "klar uppgift" : "klara uppgifter"}</p></div></div>
            {resolved.length === 0 ? <p className="muted-copy">{totalNeeds === 0 ? "Inga specialkostuppgifter finns." : "Inga uppgifter är granskade ännu."}</p> : <div className="resolved-diet-list">{resolved.map((need) => <div key={need.id}><strong>{participantNames.get(need.participant_id)}</strong><span>{currentTags(need.id).map(dietaryTagDisplayLabel).join(", ") || "Påverkar inte maten"}</span></div>)}</div>}
          </aside>
        </div>
      )}
    </section>
  );
}
