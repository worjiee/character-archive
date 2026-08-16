import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getCurrentOwnerSession, safePostLoginRedirect } from "@/src/lib/auth";
import { getRepositorySettings } from "@/src/lib/settings";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const query = await searchParams;
  const redirectTo = safePostLoginRedirect(Array.isArray(query.next) ? query.next[0] : query.next);
  if (await getCurrentOwnerSession()) redirect(redirectTo);
  const settings = await getRepositorySettings();

  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,rgba(124,58,237,0.12),transparent_34rem)] px-5 py-12">
      <section className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-2xl shadow-black/25 backdrop-blur sm:p-8">
        <div className="flex items-center gap-3">
          <div role="img" aria-label={`${settings.siteName} logo`} className="accent-solid grid h-11 w-11 place-items-center rounded-xl bg-cover bg-center text-base font-bold shadow-lg shadow-violet-950/40" style={settings.logoUrl ? { backgroundImage: `url(${JSON.stringify(settings.logoUrl).slice(1, -1)})` } : undefined}>{settings.logoUrl ? null : settings.siteName.slice(0, 1).toUpperCase()}</div>
          <div><div className="font-semibold tracking-wide text-zinc-100">{settings.siteName}</div>{settings.siteSubtitle && <div className="mt-0.5 text-xs text-zinc-500">{settings.siteSubtitle}</div>}</div>
        </div>
        <div className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-400">Private repository</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50">Owner sign in</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-400">Authenticate to access the Character Archive dashboard.</p>
        </div>
        <LoginForm redirectTo={redirectTo} />
      </section>
    </main>
  );
}
