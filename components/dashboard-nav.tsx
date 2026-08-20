"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type IconName = "characters" | "blocked" | "import" | "settings" | "logout" | "menu" | "chevron";

const primaryNavigation = [
  { href: "/characters", label: "Characters", icon: "characters" as const },
  { href: "/blocked", label: "Blocked", icon: "blocked" as const },
];

const managementGroups = [
  { label: "Import", links: [{ href: "/import", label: "Import character" }] },
  { label: "Library", links: [{ href: "/characters", label: "Characters" }, { href: "/lorebooks", label: "Lorebooks" }] },
  {
    label: "Moderation",
    links: [
      { href: "/blocked#quarantine", label: "Quarantine" },
      { href: "/blocked#block-rules", label: "Block rules" },
      { href: "/blocked#blocked-creators", label: "Blocked creators" },
    ],
  },
  {
    label: "Management",
    links: [
      { href: "/settings#deleted-characters", label: "Deleted characters" },
      { href: "/settings", label: "Settings" },
    ],
  },
];

function NavIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    characters: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 4v16M8 9h13" /></>,
    blocked: <><circle cx="12" cy="12" r="9" /><path d="m5.7 5.7 12.6 12.6" /></>,
    import: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19 15.5a7.8 7.8 0 0 0 .1-1.5l2-1.5-2-3.5-2.5 1A7 7 0 0 0 14 8.5L13.5 6h-4L9 8.5A7 7 0 0 0 6.4 10L4 9l-2 3.5L4 14a7.8 7.8 0 0 0 .1 1.5L2.5 17l2 3.5 2.3-1A7 7 0 0 0 9 20.7l.5 2.3h4l.5-2.3a7 7 0 0 0 2.2-1.2l2.3 1 2-3.5-1.5-1.5Z" /></>,
    logout: <><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
  };
  return <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export function DashboardNav() {
  const pathname = usePathname();
  return (
    <>
      <div className="hidden items-center justify-between lg:flex">
        <nav aria-label="Primary" className="flex items-center gap-1">
          <ManagementMenu />
          {primaryNavigation.map((item) => <PrimaryLink key={item.href} {...item} active={isActive(pathname, item.href)} />)}
        </nav>
        <div className="flex items-center gap-1.5">
          <span className="mr-1 flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/50 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Private</span>
          <PrimaryLink href="/settings" label="Settings" icon="settings" active={isActive(pathname, "/settings")} compact />
          <LogoutButton compact />
        </div>
      </div>
      <details className="group relative lg:hidden">
        <summary className="archive-focus grid h-9 w-9 cursor-pointer list-none place-items-center rounded-lg border border-zinc-800 bg-zinc-900/65 text-zinc-300 marker:hidden hover:bg-zinc-800 hover:text-zinc-50" aria-label="Open application menu"><NavIcon name="menu" /></summary>
        <div className="archive-surface absolute right-0 top-11 w-[min(22rem,calc(100vw-2rem))] rounded-xl border p-2.5 shadow-2xl shadow-black/40">
          <nav aria-label="Mobile primary" className="grid gap-1">
            {primaryNavigation.map((item) => <PrimaryLink key={item.href} {...item} active={isActive(pathname, item.href)} />)}
          </nav>
          <div className="my-2 border-t border-zinc-800" />
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {managementGroups.map((group) => <ManagementGroup key={group.label} group={group} />)}
          </div>
          <div className="my-2 border-t border-zinc-800" />
          <LogoutButton />
        </div>
      </details>
    </>
  );
}

function PrimaryLink({ href, label, icon, active, compact = false }: { href: string; label: string; icon: IconName; active: boolean; compact?: boolean }) {
  return <Link href={href} aria-current={active ? "page" : undefined} aria-label={compact ? label : undefined} title={compact ? label : undefined} className={`archive-focus flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${compact ? "px-2.5" : ""} ${active ? "accent-muted border" : "border border-transparent text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"}`}><NavIcon name={icon} />{compact ? <span className="sr-only">{label}</span> : label}</Link>;
}

function ManagementMenu() {
  return (
    <details className="group relative mr-1">
      <summary className="archive-focus accent-solid flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-[11px] font-bold uppercase tracking-[0.05em] marker:hidden transition hover:brightness-110"><span aria-hidden="true">＋</span>Add &amp; Manage<span className="transition group-open:rotate-90"><NavIcon name="chevron" /></span></summary>
      <div className="archive-surface absolute left-0 top-11 grid w-[30rem] grid-cols-2 gap-x-2 gap-y-1 rounded-xl border p-2.5 shadow-2xl shadow-black/40">
        {managementGroups.map((group) => <ManagementGroup key={group.label} group={group} />)}
      </div>
    </details>
  );
}

function ManagementGroup({ group }: { group: (typeof managementGroups)[number] }) {
  return <div className="rounded-lg p-2"><p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-violet-400">{group.label}</p><div className="grid gap-0.5">{group.links.map((link) => <Link key={link.href} href={link.href} className="archive-focus rounded-md px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">{link.label}</Link>)}</div></div>;
}

function LogoutButton({ compact = false }: { compact?: boolean }) {
  return <form action="/api/auth/logout" method="post"><button type="submit" aria-label={compact ? "Logout" : undefined} title={compact ? "Logout" : undefined} className={`archive-focus flex w-full items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-xs font-medium text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 ${compact ? "px-2.5" : ""}`}><NavIcon name="logout" />{compact ? <span className="sr-only">Logout</span> : "Logout"}</button></form>;
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}
