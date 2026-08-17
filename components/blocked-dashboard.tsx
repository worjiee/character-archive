"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BlockedDashboardData, ModerationRule } from "@/src/lib/moderation";
import { CharacterAvatar } from "./character-avatar";
import { SourceBadge } from "./character-badges";

interface ApiErrorBody { error?: { message?: string }; affectedCount?: number; }

export function BlockedDashboard({ data }: { data: BlockedDashboardData }) {
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

  async function addRule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    await mutate("add-rule", "/api/moderation/rules", jsonRequest("POST", {
      type: values.get("type"), value: values.get("value"),
    }), (body) => `Rule added. ${affectedMessage(body.affectedCount)}`);
    form.reset();
  }

  async function addCreator(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    await mutate("add-creator", "/api/moderation/blocked-creators", jsonRequest("POST", {
      platform: values.get("platform"), externalCreatorId: values.get("externalCreatorId"),
      creatorName: values.get("creatorName"), reason: values.get("reason"),
    }), (body) => `Creator block added. ${affectedMessage(body.affectedCount)}`);
    form.reset();
  }

  const words = data.rules.filter((rule) => rule.type === "CHARACTER_NAME" || rule.type === "KEYWORD");
  const tags = data.rules.filter((rule) => rule.type === "TAG");
  const creators = data.rules.filter((rule) => rule.type === "CREATOR_NAME" || rule.type === "CREATOR_ID");

  return (
    <div>
      <div className="border-b border-zinc-800/80 pb-6"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-400">Repository moderation</p><h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-zinc-50 sm:text-3xl">Blocked</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">Deterministic block rules, creator controls, and a reviewable quarantine—nothing is deleted automatically.</p></div>
      {feedback && <div role="status" className={`mt-5 rounded-xl border px-4 py-3 text-sm ${feedback.kind === "success" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200" : "border-red-500/20 bg-red-500/10 text-red-200"}`}>{feedback.message}</div>}

      <div className="mt-6 grid items-start gap-4 xl:grid-cols-[1.15fr_1fr_0.9fr]">
      <div id="block-rules" className="scroll-mt-20 space-y-4">
      <section className="archive-surface rounded-xl border p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-zinc-100">Add deterministic rule</h2>
        <form onSubmit={addRule} className="mt-4 grid gap-3 sm:grid-cols-[160px_1fr]">
          <select name="type" aria-label="Rule type" className={inputClass} defaultValue="KEYWORD"><option value="KEYWORD">Keyword</option><option value="CHARACTER_NAME">Character name</option><option value="TAG">Tag</option><option value="CREATOR_NAME">Creator name</option><option value="CREATOR_ID">Creator ID</option></select>
          <input name="value" aria-label="Rule value" required maxLength={500} placeholder="Value to match" className={inputClass} />
          <button disabled={busy !== null} className={`${primaryButton} sm:col-span-2`}>{busy === "add-rule" ? "Adding…" : "Add rule"}</button>
        </form>
        <p className="mt-3 text-xs text-zinc-500">New enabled rules immediately recheck existing active characters.</p>
      </section>

      <RuleSection title="Blocked words/names" description="Character-name and keyword phrase rules." rules={words} busy={busy} mutate={mutate} />
      <RuleSection title="Blocked tags" description="Exact tag matches after casing and whitespace normalization." rules={tags} busy={busy} mutate={mutate} />
      </div>

      <section id="blocked-creators" className="archive-surface scroll-mt-20 rounded-xl border p-4 sm:p-5">
        <div><h2 className="text-base font-semibold text-zinc-100">Blocked creators</h2><p className="mt-1 text-sm text-zinc-500">Block by creator ID or name, optionally limited to one platform.</p></div>
        {creators.length > 0 && <div className="mt-4 space-y-2"><p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Creator rules</p>{creators.map((rule) => <RuleRow key={rule.id} rule={rule} busy={busy} mutate={mutate} />)}</div>}
        <form onSubmit={addCreator} className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <select name="platform" aria-label="Creator platform" className={inputClass} defaultValue=""><option value="">All platforms</option><option value="JANITOR_AI">Janitor AI</option><option value="SAUCEPAN">Saucepan</option><option value="DATACAT">Legacy source</option><option value="OTHER">Other</option></select>
          <input name="externalCreatorId" aria-label="External creator ID" placeholder="Creator ID" className={inputClass} />
          <input name="creatorName" aria-label="Creator name" placeholder="Creator name" className={inputClass} />
          <input name="reason" aria-label="Creator block reason" placeholder="Reason (optional)" className={inputClass} />
          <button disabled={busy !== null} className={primaryButton}>{busy === "add-creator" ? "Adding…" : "Block creator"}</button>
        </form>
        <div className="mt-4 space-y-2">
          {data.blockedCreators.map((creator) => (
            <div key={creator.id} className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className={creator.enabled ? "" : "opacity-45"}><div className="flex flex-wrap items-center gap-2">{creator.platform ? <SourceBadge platform={creator.platform} /> : <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400">All platforms</span>}<span className="text-sm font-medium text-zinc-200">{creator.creatorName ?? "Unnamed creator"}</span>{creator.externalCreatorId && <code className="text-xs text-zinc-500">{creator.externalCreatorId}</code>}</div>{creator.reason && <p className="mt-1 text-xs text-zinc-500">{creator.reason}</p>}</div>
              <RowActions enabled={creator.enabled} busy={busy} itemKey={`creator-${creator.id}`} onToggle={() => mutate(`creator-${creator.id}`, `/api/moderation/blocked-creators/${creator.id}`, jsonRequest("PATCH", { enabled: !creator.enabled }), (body) => `Creator block ${creator.enabled ? "disabled" : "enabled"}. ${affectedMessage(body.affectedCount)}`)} onDelete={() => { if (window.confirm("Delete this blocked creator record? Quarantined characters will not be restored automatically.")) void mutate(`creator-${creator.id}`, `/api/moderation/blocked-creators/${creator.id}`, { method: "DELETE" }, () => "Blocked creator record deleted."); }} />
            </div>
          ))}
          {data.blockedCreators.length === 0 && creators.length === 0 && <Empty message="No creators are blocked." />}
        </div>
      </section>

      <section id="quarantine" className="archive-surface scroll-mt-20 rounded-xl border p-4 sm:p-5">
        <div><h2 className="text-base font-semibold text-zinc-100">Quarantined characters</h2><p className="mt-1 text-sm text-zinc-500">Review deterministic matches. Nothing is permanently deleted automatically.</p></div>
        <div className="mt-4 grid gap-3">
          {data.quarantinedCharacters.map((character) => (
            <article key={character.id} className="overflow-hidden rounded-xl border border-amber-500/15 bg-amber-500/5">
              <CharacterAvatar name={character.name} src={character.avatarUrl} className="aspect-[3/2] w-full rounded-none ring-0" />
              <div className="p-4">
              <div className="min-w-0"><Link href={`/characters/${character.id}`} className="archive-focus break-words rounded-sm font-semibold text-zinc-100 hover:text-violet-300">{character.name}</Link><p className="mt-2 text-xs leading-5 text-amber-200">{character.blockedReason ?? "Matched an enabled blocklist entry."}</p><div className="mt-2 flex flex-wrap gap-1.5">{character.tags.map((tag) => <span key={tag.slug} className="rounded bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">{tag.name}</span>)}</div><div className="mt-4 flex flex-wrap gap-2"><button disabled={busy !== null} onClick={() => void mutate(`restore-${character.id}`, `/api/moderation/characters/${character.id}`, jsonRequest("PATCH", { action: "restore" }), () => "Character restored to active status.")} className={secondaryButton}>Restore</button><button disabled={busy !== null} onClick={() => void mutate(`block-${character.id}`, `/api/moderation/characters/${character.id}`, jsonRequest("PATCH", { action: "block" }), () => "Character permanently marked as blocked.")} className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-500/15 disabled:opacity-50">Permanently block</button></div></div>
              </div>
            </article>
          ))}
          {data.quarantinedCharacters.length === 0 && <Empty message="No characters are currently quarantined." />}
        </div>
      </section>
      </div>
    </div>
  );
}

type Mutate = (key: string, url: string, options: RequestInit, success: (body: ApiErrorBody) => string) => Promise<void>;

function RuleSection({ title, description, rules, busy, mutate }: { title: string; description: string; rules: ModerationRule[]; busy: string | null; mutate: Mutate }) {
  return <section className="archive-surface rounded-xl border p-4 sm:p-5"><h2 className="text-sm font-semibold text-zinc-100">{title}</h2><p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p><div className="mt-4 space-y-2">{rules.map((rule) => <RuleRow key={rule.id} rule={rule} busy={busy} mutate={mutate} />)}{rules.length === 0 && <Empty message="No rules in this section." />}</div></section>;
}

function RuleRow({ rule, busy, mutate }: { rule: ModerationRule; busy: string | null; mutate: Mutate }) {
  return <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 sm:flex-row sm:items-center sm:justify-between"><div className={rule.enabled ? "" : "opacity-45"}><span className="rounded bg-zinc-800 px-2 py-1 text-[10px] font-semibold text-zinc-400">{rule.type.replaceAll("_", " ")}</span><span className="ml-2 text-sm text-zinc-200">{rule.value}</span></div><RowActions enabled={rule.enabled} busy={busy} itemKey={`rule-${rule.id}`} onToggle={() => mutate(`rule-${rule.id}`, `/api/moderation/rules/${rule.id}`, jsonRequest("PATCH", { enabled: !rule.enabled }), (body) => `Rule ${rule.enabled ? "disabled" : "enabled"}. ${affectedMessage(body.affectedCount)}`)} onDelete={() => { if (window.confirm("Delete this rule? Quarantined characters will not be restored automatically.")) void mutate(`rule-${rule.id}`, `/api/moderation/rules/${rule.id}`, { method: "DELETE" }, () => "Rule deleted."); }} /></div>;
}

function RowActions({ enabled, busy, itemKey, onToggle, onDelete }: { enabled: boolean; busy: string | null; itemKey: string; onToggle: () => void; onDelete: () => void }) {
  return <div className="flex gap-2"><button type="button" disabled={busy !== null} onClick={onToggle} className={secondaryButton}>{busy === itemKey ? "Working…" : enabled ? "Disable" : "Enable"}</button><button type="button" disabled={busy !== null} onClick={onDelete} className="rounded-lg px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50">Delete</button></div>;
}

function Empty({ message }: { message: string }) { return <div className="rounded-lg border border-dashed border-zinc-800 px-4 py-5 text-center text-sm text-zinc-600">{message}</div>; }
function jsonRequest(method: string, body: Record<string, unknown>): RequestInit { return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }; }
function affectedMessage(count = 0): string { return `${count} active character${count === 1 ? "" : "s"} quarantined.`; }

const inputClass = "min-w-0 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20";
const primaryButton = "accent-solid rounded-lg px-4 py-2.5 text-sm font-semibold transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50";
