import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { RepositoryBrand } from "@/components/repository-brand";
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
    <main className="archive-background grid min-h-screen place-items-center px-5 py-12">
      <section className="archive-surface w-full max-w-md rounded-2xl border p-6 shadow-2xl shadow-black/30 backdrop-blur sm:p-8">
        <RepositoryBrand settings={settings} />
        <div className="mt-8">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-400">Private repository</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-zinc-50">Owner sign in</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-400">Authenticate to open your private character library.</p>
        </div>
        <LoginForm redirectTo={redirectTo} />
      </section>
    </main>
  );
}
