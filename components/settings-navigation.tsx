import Link from "next/link";

export function SettingsNavigation({ active }: { active: "repository" | "access" }) {
  return (
    <nav aria-label="Settings" className="mt-5 flex flex-wrap gap-1 border-b border-zinc-800">
      <SettingsLink href="/settings" active={active === "repository"}>Repository</SettingsLink>
      <SettingsLink href="/settings#appearance" active={false}>Appearance</SettingsLink>
      <SettingsLink href="/settings/access" active={active === "access"}>Access</SettingsLink>
    </nav>
  );
}

function SettingsLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`archive-focus -mb-px border-b px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.08em] transition ${
        active
          ? "border-[color:var(--archive-accent)] text-[color:var(--archive-accent)]"
          : "border-transparent text-zinc-500 hover:text-zinc-200"
      }`}
    >
      {children}
    </Link>
  );
}
