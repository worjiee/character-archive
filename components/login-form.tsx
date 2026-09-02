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
    <form onSubmit={handleSubmit} className="login-form" aria-describedby={error ? "login-error" : undefined}>
      <div className="login-field">
        <label htmlFor="owner-username">Username</label>
        <input id="owner-username" name="username" type="text" required autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={loading} />
      </div>
      <div className="login-field">
        <label htmlFor="owner-password">Password</label>
        <input id="owner-password" name="password" type="password" required autoComplete="current-password" disabled={loading} />
      </div>
      {error && <p id="login-error" role="alert" className="login-error">{error}</p>}
      <button type="submit" disabled={loading} className="login-submit archive-focus">
        {loading ? "Signing in…" : "Sign in →"}
      </button>
    </form>
  );
}
