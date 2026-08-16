"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function LoginForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password"),
          redirectTo,
        }),
      });
      const result: unknown = await response.json();
      if (!response.ok || !result || typeof result !== "object") {
        setError(response.status === 429
          ? "Too many attempts. Please wait and try again."
          : "Invalid username or password.");
        return;
      }
      const destination = "redirectTo" in result && typeof result.redirectTo === "string"
        ? result.redirectTo
        : "/characters";
      router.replace(destination);
      router.refresh();
    } catch {
      setError("Unable to sign in right now. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-7 space-y-5">
      <div>
        <label htmlFor="owner-username" className="text-sm font-medium text-zinc-200">Username or email</label>
        <input id="owner-username" name="username" type="text" required autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={loading} className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3.5 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/15 disabled:opacity-60" />
      </div>
      <div>
        <label htmlFor="owner-password" className="text-sm font-medium text-zinc-200">Password</label>
        <input id="owner-password" name="password" type="password" required autoComplete="current-password" disabled={loading} className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3.5 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/15 disabled:opacity-60" />
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-sm text-red-200">{error}</p>}
      <button type="submit" disabled={loading} className="accent-solid w-full rounded-lg px-4 py-3 text-sm font-semibold shadow-lg shadow-violet-950/30 transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:ring-offset-2 focus:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-55">
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
