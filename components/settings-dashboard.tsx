"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DeletedCharacterListItem } from "@/src/lib/characters/repository";
import type { RepositorySettingsDto } from "@/src/lib/settings";
import { CharacterAvatar } from "./character-avatar";

const ACCENTS = ["#d6a84b", "#8b5cf6", "#2563eb", "#0891b2", "#059669", "#e11d48", "#facc15", "#172554"];

export function SettingsDashboard({
  settings,
  deletedCharacters,
}: {
  settings: RepositorySettingsDto;
  deletedCharacters: DeletedCharacterListItem[];
}) {
  const router = useRouter();
  const [accent, setAccent] = useState(settings.accentColor ?? "#d6a84b");
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await request("settings", "/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteName: values.get("siteName"),
        siteSubtitle: values.get("siteSubtitle"),
        logoUrl: values.get("logoUrl"),
        accentColor: accent,
        defaultTheme: values.get("defaultTheme"),
      }),
    }, "Repository settings saved.");
  }

  async function request(key: string, url: string, init: RequestInit, success: string) {
    if (busy) return;
    setBusy(key); setFeedback(null); setError(null);
    try {
      const response = await fetch(url, init);
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "The operation failed.");
      setFeedback(success);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The operation failed.");
    } finally { setBusy(null); }
  }

  return (
    <div>
      <div className="border-b border-zinc-800/80 pb-5"><p className="archive-eyebrow">Private workspace</p><h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.025em] text-zinc-50 sm:text-[1.75rem]">Settings</h1><p className="mt-1.5 max-w-2xl text-sm leading-6 text-zinc-400">Customize repository branding and appearance, or recover soft-deleted character cards.</p></div>
      {feedback && <div role="status" className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{feedback}</div>}
      {error && <div role="alert" className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}

      <div className="mt-6 grid items-start gap-5 xl:grid-cols-[1.2fr_0.8fr]">
      <section className="archive-panel p-5 sm:p-6">
        <p className="archive-eyebrow">Branding &amp; appearance</p><h2 className="mt-2 text-base font-semibold text-zinc-100">Repository identity</h2>
        <form onSubmit={saveSettings} className="mt-5 grid gap-5 lg:grid-cols-2">
          <Field label="Website name"><input name="siteName" required maxLength={80} defaultValue={settings.siteName} className={inputClass} /></Field>
          <Field label="Subtitle"><input name="siteSubtitle" maxLength={160} defaultValue={settings.siteSubtitle ?? ""} className={inputClass} /></Field>
          <Field label="Logo URL"><input name="logoUrl" type="text" defaultValue={settings.logoUrl ?? ""} placeholder="https://… or /logo.svg" className={inputClass} /></Field>
          <Field label="Theme preference"><select name="defaultTheme" defaultValue={settings.defaultTheme} className={inputClass}><option value="DARK">Dark</option><option value="LIGHT">Light</option><option value="SYSTEM">System</option></select></Field>
          <fieldset className="lg:col-span-2"><legend className="text-sm font-medium text-zinc-200">Accent color</legend><div className="mt-3 flex flex-wrap items-center gap-3">{ACCENTS.map((color) => <button key={color} type="button" onClick={() => setAccent(color)} aria-label={`Use accent ${color}`} aria-pressed={accent === color} className="h-9 w-9 rounded-full ring-offset-2 ring-offset-zinc-900 transition" style={{ backgroundColor: color, boxShadow: accent === color ? `0 0 0 2px var(--surface-1), 0 0 0 4px ${color}` : undefined }} />)}<label className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-400">Custom<input aria-label="Custom accent color" type="color" value={accent} onChange={(event) => setAccent(event.target.value)} className="h-6 w-8 cursor-pointer border-0 bg-transparent" /><code>{accent}</code></label></div></fieldset>
          <div className="lg:col-span-2"><button disabled={busy !== null} className="archive-button-primary archive-focus">{busy === "settings" ? "Saving…" : "Save settings"}</button></div>
        </form>
      </section>

      <section id="deleted-characters" className="archive-panel scroll-mt-20 p-5 sm:p-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">Library management</p><h2 className="mt-2 text-base font-semibold text-zinc-100">Deleted characters</h2><p className="mt-1 text-sm leading-6 text-zinc-500">Deletion is reversible. Source records and related data remain intact.</p>
        <div className="mt-4 space-y-3">
          {deletedCharacters.map((character) => <div key={character.id} className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950/45 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-center gap-3"><CharacterAvatar name={character.name} src={character.avatarUrl} className="h-12 w-10 rounded-md" /><div className="min-w-0"><Link href={`/characters/${character.id}`} className="truncate text-sm font-medium text-zinc-200 hover:text-violet-300">{character.name}</Link><p className="mt-1 text-xs text-zinc-500">Previous status: {character.statusBeforeDelete ?? "Active"}</p></div></div><button disabled={busy !== null} onClick={() => void request(`restore-${character.id}`, `/api/characters/${character.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore" }) }, `${character.name} restored.`)} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">{busy === `restore-${character.id}` ? "Restoring…" : "Restore"}</button></div>)}
          {deletedCharacters.length === 0 && <div className="rounded-lg border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-600">No deleted characters.</div>}
        </div>
      </section>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="text-sm font-medium text-zinc-200">{label}</span><span className="mt-2 block">{children}</span></label>; }
const inputClass = "archive-input";
