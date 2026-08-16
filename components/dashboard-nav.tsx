"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type IconName = "characters" | "blocked" | "import" | "settings" | "logout";

const navigation: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/characters", label: "Characters", icon: "characters" },
  { href: "/blocked", label: "Blocked", icon: "blocked" },
  { href: "/import", label: "Import", icon: "import" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

function NavIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    characters: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    blocked: <><circle cx="12" cy="12" r="9" /><path d="m5.7 5.7 12.6 12.6" /></>,
    import: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19 15.5a7.8 7.8 0 0 0 .1-1.5l2-1.5-2-3.5-2.5 1A7 7 0 0 0 14 8.5L13.5 6h-4L9 8.5A7 7 0 0 0 6.4 10L4 9l-2 3.5L4 14a7.8 7.8 0 0 0 .1 1.5L2.5 17l2 3.5 2.3-1A7 7 0 0 0 9 20.7l.5 2.3h4l.5-2.3a7 7 0 0 0 2.2-1.2l2.3 1 2-3.5-1.5-1.5Z" /></>,
    logout: <><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /></>,
  };

  return <svg aria-hidden="true" className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex gap-1 overflow-x-auto lg:flex-col">
      {navigation.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`flex min-w-fit items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${active ? "bg-violet-500/12 text-violet-300 ring-1 ring-inset ring-violet-400/15" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"}`}>
            <NavIcon name={item.icon} />
            {item.label}
          </Link>
        );
      })}
      <form action="/api/auth/logout" method="post" className="min-w-fit">
        <button type="submit" className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-100">
          <NavIcon name="logout" />
          Logout
        </button>
      </form>
    </nav>
  );
}
