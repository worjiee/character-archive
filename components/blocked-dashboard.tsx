"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  BlockedCreatorsData,
  BlockRulesData,
  ModerationOverviewData,
  ModerationRule,
  QuarantineData,
} from "@/src/lib/moderation";
import { getSourceIdentity, PERSISTED_SOURCE_PLATFORM_KEYS } from "../src/lib/sources/presentation";
import { CharacterAvatar } from "./character-avatar";
import { SourceBadge } from "./character-badges";

interface ApiErrorBody { error?: { message?: string }; affectedCount?: number; }
type Mutate = (key: string, url: string, options: RequestInit, success: (body: ApiErrorBody) => string) => Promise<void>;

export function ModerationOverview({ data }: { data: ModerationOverviewData }) {
  const cards = [
    { label: "Quarantined characters", value: data.quarantinedCharacters, href: "/blocked/quarantine", action: "Review Quarantine" },
    { label: "Active block rules", value: data.activeBlockRules, secondary: `${data.disabledBlockRules} disabled`, href: "/blocked/rules", action: "Manage Block Rules" },
    { label: "Enabled blocked creators", value: data.enabledBlockedCreators, secondary: `${data.disabledBlockedCreators} disabled`, href: "/blocked/creators", action: "Manage Blocked Creators" },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {cards.map((card) => (
        <section key={card.label} className="archive-panel flex min-h-48 flex-col p-5">
          <p className="text-sm font-medium text-zinc-400">{card.label}</p>
          <p className="mt-3 text-4xl font-semibold tracking-tight text-zinc-50">{card.value}</p>
          {card.secondary && <p className="mt-1 text-xs text-zinc-500">{card.secondary}</p>}
          <Link href={card.href} className="archive-button-secondary archive-focus mt-auto min-h-11 justify-center px-4 py-2.5">
            {card.action}
          </Link>
        </section>
      ))}
    </div>
  );
}

export function BlockRulesManagement({ data }: { data: BlockRulesData }) {
  const { busy, feedback, mutate } = useModerationMutation();
  const words = data.rules.filter((rule) => rule.type === "CHARACTER_NAME" || rule.type === "KEYWORD");
  const tags = data.rules.filter((rule) => rule.type === "TAG");
  const creators = data.rules.filter((rule) => rule.type === "CREATOR_NAME" || rule.type === "CREATOR_ID");

  async function addRule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    await mutate("add-rule", "/api/moderation/rules", jsonRequest("POST", {
      type: values.get("type"),
      value: values.get("value"),
    }), (body) => `Rule added. ${affectedMessage(body.affectedCount)}`);
    form.reset();
  }

  return (
    <div>
      <Feedback feedback={feedback} />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section className="archive-panel p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-zinc-100">Add deterministic rule</h2>
          <form onSubmit={addRule} className="mt-4 grid gap-3 sm:grid-cols-[160px_1fr]">
            <select name="type" aria-label="Rule type" className={inputClass} defaultValue="KEYWORD">
              <option value="KEYWORD">Keyword</option><option value="CHARACTER_NAME">Character name</option>
              <option value="TAG">Tag</option><option value="CREATOR_NAME">Creator name</option><option value="CREATOR_ID">Creator ID</option>
            </select>
            <input name="value" aria-label="Rule value" required maxLength={500} placeholder="Value to match" className={inputClass} />
            <button disabled={busy !== null} className={`${primaryButton} sm:col-span-2`}>{busy === "add-rule" ? "Adding…" : "Add rule"}</button>
          </form>
          <p className="mt-3 text-xs text-zinc-500">New enabled rules immediately recheck existing active characters.</p>
        </section>
        <RuleSection title="Blocked words and names" description="Character-name and keyword phrase rules." rules={words} busy={busy} mutate={mutate} />
        <RuleSection title="Blocked tags" description="Exact tag matches after casing and whitespace normalization." rules={tags} busy={busy} mutate={mutate} />
        <RuleSection title="Creator rules" description="Creator-name and creator-ID rules across imported source records." rules={creators} busy={busy} mutate={mutate} />
      </div>
    </div>
  );
}

export function BlockedCreatorsManagement({ data }: { data: BlockedCreatorsData }) {
  const { busy, feedback, mutate } = useModerationMutation();

  async function addCreator(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    await mutate("add-creator", "/api/moderation/blocked-creators", jsonRequest("POST", {
      platform: values.get("platform"),
      externalCreatorId: values.get("externalCreatorId"),
      creatorName: values.get("creatorName"),
      reason: values.get("reason"),
    }), (body) => `Creator block added. ${affectedMessage(body.affectedCount)}`);
    form.reset();
  }

  return (
    <div>
      <Feedback feedback={feedback} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(18rem,0.75fr)_minmax(0,1.25fr)]">
        <section className="archive-panel p-4 sm:p-5">
          <h2 className="text-base font-semibold text-zinc-100">Block a creator</h2>
          <p className="mt-1 text-sm text-zinc-500">Block by creator ID or name, optionally limited to one platform.</p>
          <form onSubmit={addCreator} className="mt-5 grid gap-3">
            <select name="platform" aria-label="Creator platform" className={inputClass} defaultValue="">
              <option value="">All platforms</option>
              {PERSISTED_SOURCE_PLATFORM_KEYS.map((platform) => <option key={platform} value={platform}>{getSourceIdentity(platform).label}</option>)}
            </select>
            <input name="externalCreatorId" aria-label="External creator ID" placeholder="Creator ID" className={inputClass} />
            <input name="creatorName" aria-label="Creator name" placeholder="Creator name" className={inputClass} />
            <input name="reason" aria-label="Creator block reason" placeholder="Reason (optional)" className={inputClass} />
            <button disabled={busy !== null} className={primaryButton}>{busy === "add-creator" ? "Adding…" : "Block creator"}</button>
          </form>
          <p className="mt-3 text-xs text-zinc-500">New enabled creator blocks immediately recheck active characters.</p>
        </section>
        <section className="archive-panel p-4 sm:p-5">
          <h2 className="text-base font-semibold text-zinc-100">Blocked creators</h2>
          <div className="mt-4 space-y-2">
            {data.blockedCreators.map((creator) => (
              <div key={creator.id} className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className={creator.enabled ? "" : "opacity-45"}>
                  <div className="flex flex-wrap items-center gap-2">
                    {creator.platform ? <SourceBadge platform={creator.platform} variant="compact" /> : <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400">All platforms</span>}
                    <span className="text-sm font-medium text-zinc-200">{creator.creatorName ?? "Unnamed creator"}</span>
                    {creator.externalCreatorId && <code className="break-all text-xs text-zinc-500">{creator.externalCreatorId}</code>}
                  </div>
                  {creator.reason && <p className="mt-1 text-xs text-zinc-500">{creator.reason}</p>}
                </div>
                <RowActions enabled={creator.enabled} busy={busy} itemKey={`creator-${creator.id}`}
                  onToggle={() => mutate(`creator-${creator.id}`, `/api/moderation/blocked-creators/${creator.id}`, jsonRequest("PATCH", { enabled: !creator.enabled }), (body) => `Creator block ${creator.enabled ? "disabled" : "enabled"}. ${affectedMessage(body.affectedCount)}`)}
                  onDelete={() => { if (window.confirm("Delete this blocked creator record? Quarantined characters will not be restored automatically.")) void mutate(`creator-${creator.id}`, `/api/moderation/blocked-creators/${creator.id}`, { method: "DELETE" }, () => "Blocked creator record deleted."); }} />
              </div>
            ))}
            {data.blockedCreators.length === 0 && <Empty message="No creators are blocked." />}
          </div>
        </section>
      </div>
    </div>
  );
}

export function QuarantineManagement({ data }: { data: QuarantineData }) {
  const { busy, feedback, mutate } = useModerationMutation();
  return (
    <div>
      <Feedback feedback={feedback} />
      <section className="archive-panel p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.quarantinedCharacters.map((character) => (
            <article key={character.id} className="overflow-hidden rounded-xl border border-amber-500/15 bg-amber-500/5">
              <CharacterAvatar name={character.name} src={character.avatarUrl} className="aspect-[3/2] w-full rounded-none ring-0" />
              <div className="p-4">
                <Link href={`/characters/${character.id}`} className="archive-focus break-words rounded-sm font-semibold text-zinc-100 hover:text-violet-300">{character.name}</Link>
                <p className="mt-2 text-xs leading-5 text-amber-200">{character.blockedReason ?? "Matched an enabled blocklist entry."}</p>
                {character.sources.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{character.sources.map((source, index) => <span key={`${source.platform}-${source.creatorName ?? index}`} className="text-[11px] text-zinc-500">{getSourceIdentity(source.platform).label}{source.creatorName ? ` · ${source.creatorName}` : ""}</span>)}</div>}
                <div className="mt-2 flex flex-wrap gap-1.5">{character.tags.map((tag) => <span key={tag.slug} className="rounded bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">{tag.name}</span>)}</div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button disabled={busy !== null} onClick={() => void mutate(`restore-${character.id}`, `/api/moderation/characters/${character.id}`, jsonRequest("PATCH", { action: "restore" }), () => "Character restored to active status.")} className={secondaryButton}>Restore</button>
                  <button disabled={busy !== null} onClick={() => void mutate(`block-${character.id}`, `/api/moderation/characters/${character.id}`, jsonRequest("PATCH", { action: "block" }), () => "Character permanently marked as blocked.")} className="moderation-control archive-focus rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-200 hover:bg-red-500/15 disabled:opacity-50">Permanently block</button>
                </div>
              </div>
            </article>
          ))}
          {data.quarantinedCharacters.length === 0 && <Empty message="No characters are currently quarantined." />}
        </div>
      </section>
    </div>
  );
}

function useModerationMutation() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  async function mutate(key: string, url: string, options: RequestInit, success: (body: ApiErrorBody) => string) {
    if (busy) return;
    setBusy(key); setFeedback(null);
    try {
      const response = await fetch(url, options);
      const body = response.status === 204 ? {} : await response.json() as ApiErrorBody;
      if (!response.ok) throw new Error(body.error?.message ?? "The moderation operation failed.");
      setFeedback({ kind: "success", message: success(body) });
      router.refresh();
    } catch (error) {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "The moderation operation failed." });
    } finally { setBusy(null); }
  }
  return { busy, feedback, mutate };
}

function Feedback({ feedback }: { feedback: { kind: "success" | "error"; message: string } | null }) {
  if (!feedback) return null;
  return <div role="status" className={`mb-5 rounded-xl border px-4 py-3 text-sm ${feedback.kind === "success" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200" : "border-red-500/20 bg-red-500/10 text-red-200"}`}>{feedback.message}</div>;
}

function RuleSection({ title, description, rules, busy, mutate }: { title: string; description: string; rules: ModerationRule[]; busy: string | null; mutate: Mutate }) {
  return <section className="archive-panel p-4 sm:p-5"><h2 className="text-sm font-semibold text-zinc-100">{title}</h2><p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p><div className="mt-4 space-y-2">{rules.map((rule) => <RuleRow key={rule.id} rule={rule} busy={busy} mutate={mutate} />)}{rules.length === 0 && <Empty message="No rules in this section." />}</div></section>;
}

function RuleRow({ rule, busy, mutate }: { rule: ModerationRule; busy: string | null; mutate: Mutate }) {
  return <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 sm:flex-row sm:items-center sm:justify-between"><div className={`min-w-0 ${rule.enabled ? "" : "opacity-45"}`}><span className="rounded bg-zinc-800 px-2 py-1 text-[10px] font-semibold text-zinc-400">{rule.type.replaceAll("_", " ")}</span><span className="ml-2 break-words text-sm text-zinc-200">{rule.value}</span></div><RowActions enabled={rule.enabled} busy={busy} itemKey={`rule-${rule.id}`} onToggle={() => mutate(`rule-${rule.id}`, `/api/moderation/rules/${rule.id}`, jsonRequest("PATCH", { enabled: !rule.enabled }), (body) => `Rule ${rule.enabled ? "disabled" : "enabled"}. ${affectedMessage(body.affectedCount)}`)} onDelete={() => { if (window.confirm("Delete this rule? Quarantined characters will not be restored automatically.")) void mutate(`rule-${rule.id}`, `/api/moderation/rules/${rule.id}`, { method: "DELETE" }, () => "Rule deleted."); }} /></div>;
}

function RowActions({ enabled, busy, itemKey, onToggle, onDelete }: { enabled: boolean; busy: string | null; itemKey: string; onToggle: () => void; onDelete: () => void }) {
  return <div className="flex shrink-0 gap-2"><button type="button" disabled={busy !== null} onClick={onToggle} className={secondaryButton}>{busy === itemKey ? "Working…" : enabled ? "Disable" : "Enable"}</button><button type="button" disabled={busy !== null} onClick={onDelete} className="moderation-control archive-focus rounded-lg px-3 py-2 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50">Delete</button></div>;
}

function Empty({ message }: { message: string }) { return <div className="col-span-full rounded-lg border border-dashed border-zinc-800 px-4 py-5 text-center text-sm text-zinc-600">{message}</div>; }
function jsonRequest(method: string, body: Record<string, unknown>): RequestInit { return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }; }
function affectedMessage(count = 0): string { return `${count} active character${count === 1 ? "" : "s"} quarantined.`; }

const inputClass = "moderation-control archive-input min-w-0";
const primaryButton = "moderation-control archive-button-primary archive-focus";
const secondaryButton = "moderation-control archive-button-secondary archive-focus px-3 py-2";
