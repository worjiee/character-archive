"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CharacterDetail } from "@/src/lib/characters/repository";

export function CharacterManagementPanel({ character }: { character: CharacterDetail }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function request(key: string, url: string, init: RequestInit, success: string, redirect = false) {
    if (busy) return;
    setBusy(key); setFeedback(null); setError(null);
    try {
      const response = await fetch(url, init);
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The operation failed.");
      if (redirect) router.push("/characters");
      else { setFeedback(success); router.refresh(); }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The operation failed.");
    } finally { setBusy(null); }
  }

  async function saveOverrides(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await request("overrides", `/api/characters/${character.id}`, jsonRequest("PATCH", {
      action: "update-overrides",
      name: values.get("name"),
      description: values.get("description"),
      personality: values.get("personality"),
      scenario: values.get("scenario"),
      avatarUrl: values.get("avatarUrl"),
    }), "Local character presentation saved.");
  }

  async function moveGreeting(index: number, offset: number) {
    const destination = index + offset;
    if (destination < 0 || destination >= character.greetings.length) return;
    const ids = character.greetings.map((greeting) => greeting.id);
    [ids[index], ids[destination]] = [ids[destination], ids[index]];
    await request("greeting-order", `/api/characters/${character.id}/greetings`, jsonRequest("PATCH", {
      action: "reorder", greetingIds: ids,
    }), "Greeting order updated.");
  }

  return (
    <section className="mt-8 rounded-xl border border-zinc-800/70 bg-zinc-950/25 p-4 sm:p-5">
      <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">Owner tools</p><h2 className="mt-2 text-sm font-semibold text-zinc-200">Character management</h2><p className="mt-1 text-xs leading-5 text-zinc-500">Local presentation overrides survive future source imports.</p></div>
      {feedback && <div role="status" className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{feedback}</div>}
      {error && <div role="alert" className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      <details className="group mt-5 rounded-lg border border-zinc-800 bg-zinc-950/35"><summary className="archive-focus cursor-pointer list-none rounded-lg px-4 py-3 text-xs font-medium text-zinc-200 marker:hidden">Local display overrides<span className="float-right text-zinc-500 transition group-open:rotate-45">＋</span></summary><form onSubmit={saveOverrides} className="grid gap-4 border-t border-zinc-800 p-4">
        <Field label="Display name"><input name="name" required maxLength={200} defaultValue={character.name} className={inputClass} /></Field>
        <Field label="Avatar URL"><input name="avatarUrl" defaultValue={character.avatarUrl ?? ""} className={inputClass} /></Field>
        <Field label="Description"><textarea name="description" rows={4} defaultValue={character.description ?? ""} className={inputClass} /></Field>
        <Field label="Personality"><textarea name="personality" rows={4} defaultValue={character.personality ?? ""} className={inputClass} /></Field>
        <Field label="Scenario"><textarea name="scenario" rows={4} defaultValue={character.scenario ?? ""} className={inputClass} /></Field>
        <div className="flex flex-wrap gap-2"><button disabled={busy !== null} className={primaryButton}>{busy === "overrides" ? "Saving…" : "Save local overrides"}</button>{character.hasLocalOverrides && <button type="button" disabled={busy !== null} onClick={() => void request("reset", `/api/characters/${character.id}`, jsonRequest("PATCH", { action: "reset-overrides" }), "Imported source values restored.")} className={secondaryButton}>Use imported values</button>}</div>
      </form></details>

      <details className="group mt-3 rounded-lg border border-zinc-800 bg-zinc-950/35"><summary className="archive-focus cursor-pointer list-none rounded-lg px-4 py-3 text-xs font-medium text-zinc-200 marker:hidden">Greeting presentation ({character.greetings.length})<span className="float-right text-zinc-500 transition group-open:rotate-45">＋</span></summary><div className="space-y-3 border-t border-zinc-800 p-4">{character.greetings.map((greeting, index) => <div key={greeting.id} className={`rounded-lg border border-zinc-800 p-3 ${greeting.hidden ? "opacity-50" : ""}`}><div className="flex gap-3"><span className="font-mono text-[10px] text-violet-400">{String(index + 1).padStart(2, "0")}</span><p className="line-clamp-2 text-xs leading-5 text-zinc-400">{greeting.content}</p></div><div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" aria-label={`Move greeting ${index + 1} up`} disabled={busy !== null || index === 0} onClick={() => void moveGreeting(index, -1)} className={smallButton}>↑</button><button type="button" aria-label={`Move greeting ${index + 1} down`} disabled={busy !== null || index === character.greetings.length - 1} onClick={() => void moveGreeting(index, 1)} className={smallButton}>↓</button><button type="button" disabled={busy !== null} onClick={() => void request(`visibility-${greeting.id}`, `/api/characters/${character.id}/greetings`, jsonRequest("PATCH", { action: "visibility", greetingId: greeting.id, hidden: !greeting.hidden }), greeting.hidden ? "Greeting shown." : "Greeting hidden.")} className={secondaryButton}>{greeting.hidden ? "Show" : "Hide"}</button><span className="ml-auto text-[11px] text-zinc-600">Local order {index + 1}</span></div></div>)}</div></details>

      <div className="mt-5 grid gap-4 border-t border-zinc-800 pt-5 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="Moderation status"><select defaultValue={character.status} disabled={busy !== null} onChange={(event) => void request("status", `/api/characters/${character.id}`, jsonRequest("PATCH", { action: "status", status: event.target.value }), "Moderation status updated.")} className={inputClass}><option value="ACTIVE">Active</option><option value="QUARANTINED">Quarantined</option><option value="BLOCKED">Blocked</option></select></Field>
        <button type="button" disabled={busy !== null} onClick={() => { if (window.confirm("Soft-delete this character? It can be restored from Settings.")) void request("delete", `/api/characters/${character.id}`, { method: "DELETE" }, "Character deleted.", true); }} className="rounded-lg border border-red-500/25 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-300 hover:bg-red-500/15 disabled:opacity-50">Soft-delete character</button>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="text-xs font-medium text-zinc-300">{label}</span><span className="mt-1.5 block">{children}</span></label>; }
function jsonRequest(method: string, body: Record<string, unknown>): RequestInit { return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }; }
const inputClass = "w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20";
const primaryButton = "accent-solid rounded-lg px-3.5 py-2 text-sm font-semibold transition hover:brightness-110 disabled:opacity-50";
const secondaryButton = "rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50";
const smallButton = "grid h-8 w-8 place-items-center rounded-lg border border-zinc-700 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-30";
