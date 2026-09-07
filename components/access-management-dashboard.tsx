"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ManagedUserDto } from "@/src/lib/users/access-management";
import { SettingsNavigation } from "./settings-navigation";

type DialogState =
  | { type: "create" }
  | { type: "revoke"; user: ManagedUserDto }
  | { type: "reset"; user: ManagedUserDto }
  | null;

interface ErrorBody {
  error?: { code?: string; message?: string } | string;
}

export function AccessManagementDashboard({ users }: { users: ManagedUserDto[] }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submitCreate(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    await runRequest(
      "create",
      "/api/admin/users",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: values.get("username"),
          displayName: values.get("displayName"),
          password: values.get("password"),
          confirmPassword: values.get("confirmPassword"),
        }),
      },
      "Member access created.",
    );
  }

  async function submitReset(event: React.FormEvent<HTMLFormElement>, user: ManagedUserDto): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    await runRequest(
      `reset-${user.id}`,
      `/api/admin/users/${encodeURIComponent(user.id)}/reset-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: values.get("password"),
          confirmPassword: values.get("confirmPassword"),
        }),
      },
      `Password reset for ${user.username}. All existing sessions were signed out.`,
    );
  }

  async function runRequest(key: string, url: string, init: RequestInit, success: string): Promise<void> {
    if (busy) return;
    setBusy(key);
    setError(null);
    setFeedback(null);
    try {
      const response = await fetch(url, init);
      const body = await response.json() as ErrorBody;
      if (!response.ok) {
        const message = typeof body.error === "object" ? body.error?.message : body.error;
        throw new Error(message || "The access-management operation failed.");
      }
      setDialog(null);
      setFeedback(success);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The access-management operation failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="border-b border-zinc-800/80 pb-5">
        <p className="archive-eyebrow">Private workspace</p>
        <div className="mt-1.5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.025em] text-zinc-50 sm:text-[1.75rem]">Settings</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-zinc-400">Grant and manage access for trusted Character Archive members.</p>
          </div>
          <button type="button" onClick={() => { setError(null); setDialog({ type: "create" }); }} className="archive-button-primary archive-focus">
            Add member
          </button>
        </div>
        <SettingsNavigation active="access" />
      </div>

      {feedback && <div role="status" className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{feedback}</div>}
      {error && !dialog && <div role="alert" className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}

      <section className="archive-panel mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 sm:px-5">
          <div>
            <p className="archive-eyebrow">Authorized users</p>
            <h2 className="mt-1 text-sm font-semibold uppercase tracking-[0.06em] text-zinc-200">{users.length} {users.length === 1 ? "user" : "users"}</h2>
          </div>
          <span className="archive-chip">Invite only</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] border-collapse text-left">
            <thead className="font-interface bg-zinc-950/35 text-[0.62rem] uppercase tracking-[0.12em] text-zinc-600">
              <tr>
                <th className="px-5 py-2.5 font-semibold">Username</th>
                <th className="px-4 py-2.5 font-semibold">Display name</th>
                <th className="px-4 py-2.5 font-semibold">Role</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Created</th>
                <th className="px-5 py-2.5 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {users.map((user) => (
                <tr key={user.id} className="text-xs text-zinc-400">
                  <td className="px-5 py-3"><span className="font-medium text-zinc-100">{user.username}</span><span className="mt-0.5 block font-mono text-[0.62rem] text-zinc-700">{user.id}</span></td>
                  <td className="px-4 py-3">{user.displayName ?? <span className="text-zinc-700">—</span>}</td>
                  <td className="px-4 py-3"><RoleBadge role={user.role} /></td>
                  <td className="px-4 py-3"><StatusBadge status={user.accessStatus} /></td>
                  <td className="px-4 py-3"><time dateTime={new Date(user.createdAt).toISOString()}>{formatDate(user.createdAt)}</time></td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-2">
                      {user.role === "ADMIN" ? (
                        <span className="rounded-md border border-amber-500/20 bg-amber-500/8 px-2.5 py-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-amber-300">Protected</span>
                      ) : (
                        <>
                          <button type="button" disabled={busy !== null} onClick={() => { setError(null); setDialog({ type: "reset", user }); }} className="archive-focus rounded-md border border-zinc-700 px-2.5 py-1.5 text-[0.68rem] font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">Reset password</button>
                          {user.accessStatus === "ACTIVE" ? (
                            <button type="button" disabled={busy !== null} onClick={() => { setError(null); setDialog({ type: "revoke", user }); }} className="archive-focus rounded-md border border-red-500/25 px-2.5 py-1.5 text-[0.68rem] font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-50">Revoke</button>
                          ) : (
                            <button type="button" disabled={busy !== null} onClick={() => void runRequest(`reactivate-${user.id}`, `/api/admin/users/${encodeURIComponent(user.id)}/reactivate`, { method: "POST" }, `${user.username} reactivated. They must sign in again.`)} className="archive-focus rounded-md border border-emerald-500/25 px-2.5 py-1.5 text-[0.68rem] font-medium text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50">{busy === `reactivate-${user.id}` ? "Reactivating…" : "Reactivate"}</button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {dialog?.type === "create" && (
        <Modal title="Add member" description="Create an ACTIVE MEMBER account for a trusted user." onClose={() => setDialog(null)}>
          <form onSubmit={(event) => void submitCreate(event)} className="mt-5 grid gap-4">
            <Field label="Username"><input name="username" required maxLength={320} autoComplete="off" className="archive-input" /></Field>
            <Field label="Display name" optional><input name="displayName" maxLength={160} autoComplete="off" className="archive-input" /></Field>
            <Field label="Password"><input name="password" type="password" required minLength={12} maxLength={1024} autoComplete="new-password" className="archive-input" /></Field>
            <Field label="Confirm password"><input name="confirmPassword" type="password" required minLength={12} maxLength={1024} autoComplete="new-password" className="archive-input" /></Field>
            {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
            <ModalActions onCancel={() => setDialog(null)} pending={busy === "create"} submitLabel="Create member" pendingLabel="Creating…" />
          </form>
        </Modal>
      )}

      {dialog?.type === "revoke" && (
        <Modal title={`Revoke ${dialog.user.username}?`} description="This immediately signs the user out on all devices. Their Favorites and Cart remain stored." onClose={() => setDialog(null)}>
          {error && <p role="alert" className="mt-4 text-xs text-red-300">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" disabled={busy !== null} onClick={() => setDialog(null)} className="archive-button-secondary archive-focus">Cancel</button>
            <button type="button" disabled={busy !== null} onClick={() => void runRequest(`revoke-${dialog.user.id}`, `/api/admin/users/${encodeURIComponent(dialog.user.id)}/revoke`, { method: "POST" }, `${dialog.user.username} revoked and signed out.`)} className="archive-focus rounded-lg border border-red-500/30 bg-red-500/15 px-4 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/25 disabled:opacity-50">{busy === `revoke-${dialog.user.id}` ? "Revoking…" : "Revoke access"}</button>
          </div>
        </Modal>
      )}

      {dialog?.type === "reset" && (
        <Modal title={`Reset ${dialog.user.username}'s password`} description="All existing sessions will be signed out. The member must use the replacement password on their next login." onClose={() => setDialog(null)}>
          <form onSubmit={(event) => void submitReset(event, dialog.user)} className="mt-5 grid gap-4">
            <Field label="New password"><input name="password" type="password" required minLength={12} maxLength={1024} autoComplete="new-password" className="archive-input" /></Field>
            <Field label="Confirm password"><input name="confirmPassword" type="password" required minLength={12} maxLength={1024} autoComplete="new-password" className="archive-input" /></Field>
            {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
            <ModalActions onCancel={() => setDialog(null)} pending={busy === `reset-${dialog.user.id}`} submitLabel="Reset password" pendingLabel="Resetting…" />
          </form>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="access-dialog-title" className="archive-panel w-full max-w-md p-5 shadow-2xl shadow-black/70 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div><p className="archive-eyebrow">Access management</p><h2 id="access-dialog-title" className="mt-1.5 text-lg font-semibold text-zinc-100">{title}</h2><p className="mt-2 text-sm leading-6 text-zinc-500">{description}</p></div>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="archive-focus rounded-md px-2 py-1 text-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100">×</button>
        </div>
        {children}
      </section>
    </div>
  );
}

function Field({ label, optional = false, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return <label className="block"><span className="flex items-center justify-between text-xs font-medium text-zinc-300"><span>{label}</span>{optional && <span className="text-[0.62rem] uppercase tracking-[0.08em] text-zinc-600">Optional</span>}</span><span className="mt-2 block">{children}</span></label>;
}

function ModalActions({ onCancel, pending, submitLabel, pendingLabel }: { onCancel: () => void; pending: boolean; submitLabel: string; pendingLabel: string }) {
  return <div className="mt-1 flex justify-end gap-2 border-t border-zinc-800 pt-4"><button type="button" disabled={pending} onClick={onCancel} className="archive-button-secondary archive-focus">Cancel</button><button type="submit" disabled={pending} className="archive-button-primary archive-focus">{pending ? pendingLabel : submitLabel}</button></div>;
}

function RoleBadge({ role }: { role: ManagedUserDto["role"] }) {
  return <span className={`rounded-md border px-2 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.08em] ${role === "ADMIN" ? "border-amber-500/25 bg-amber-500/10 text-amber-300" : "border-violet-500/25 bg-violet-500/10 text-violet-300"}`}>{role}</span>;
}

function StatusBadge({ status }: { status: ManagedUserDto["accessStatus"] }) {
  return <span className={`inline-flex items-center gap-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.08em] ${status === "ACTIVE" ? "text-emerald-300" : "text-zinc-500"}`}><span className={`h-1.5 w-1.5 rounded-full ${status === "ACTIVE" ? "bg-emerald-400" : "bg-zinc-600"}`} />{status}</span>;
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "2-digit" }).format(new Date(value));
}
