import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { RepositoryBrand } from "@/components/repository-brand";
import { getCurrentUserSession, safePostLoginRedirect } from "@/src/lib/auth";
import { getRepositorySettings } from "@/src/lib/settings";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const query = await searchParams;
  const redirectTo = safePostLoginRedirect(Array.isArray(query.next) ? query.next[0] : query.next);
  if (await getCurrentUserSession()) redirect(redirectTo);
  const settings = await getRepositorySettings();

  return (
    <main className="login-page archive-background">
      <section className="login-card archive-surface">
        <RepositoryBrand settings={settings} presentation="login" />
        <div className="login-intro">
          <h1>Welcome back</h1>
          <p>Sign in to access the archive.</p>
        </div>
        <LoginForm redirectTo={redirectTo} />
      </section>
    </main>
  );
}
