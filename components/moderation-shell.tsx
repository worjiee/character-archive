"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export type ModerationSection = "overview" | "quarantine" | "rules" | "creators";

export const moderationNavigation = [
  { key: "overview", href: "/blocked", label: "Overview" },
  { key: "quarantine", href: "/blocked/quarantine", label: "Quarantine" },
  { key: "rules", href: "/blocked/rules", label: "Block Rules" },
  { key: "creators", href: "/blocked/creators", label: "Blocked Creators" },
] as const;

export function ModerationShell({
  active,
  title,
  description,
  children,
}: {
  active: ModerationSection;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <header className="border-b border-zinc-800/80 pb-5">
        <p className="archive-eyebrow">Moderation</p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.025em] text-zinc-50 sm:text-[1.75rem]">{title}</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-zinc-400">{description}</p>
        <nav aria-label="Moderation" className="moderation-tabs mt-5">
          {moderationNavigation.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active === item.key ? "page" : undefined}
              data-active={active === item.key || undefined}
              className="moderation-tab archive-focus"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <div className="mt-6">{children}</div>
    </div>
  );
}

export function LegacyModerationFragmentRedirect() {
  const router = useRouter();

  useEffect(() => {
    const redirectLegacyFragment = () => {
      const destination = legacyModerationDestination(window.location.pathname, window.location.hash);
      if (destination) router.replace(destination);
    };
    redirectLegacyFragment();
    window.addEventListener("hashchange", redirectLegacyFragment);
    return () => window.removeEventListener("hashchange", redirectLegacyFragment);
  }, [router]);

  return null;
}

export function legacyModerationDestination(pathname: string, hash: string): string | null {
  if (pathname !== "/blocked") return null;
  return {
    "#quarantine": "/blocked/quarantine",
    "#block-rules": "/blocked/rules",
    "#blocked-creators": "/blocked/creators",
  }[hash] ?? null;
}
