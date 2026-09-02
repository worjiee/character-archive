"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useReducer, useRef } from "react";
import { useCharacterCollections } from "./character-collections-provider";
import { CollectionIcon } from "./collection-icon";
import type { UserRole } from "@/src/lib/auth";

type IconName = "home" | "characters" | "lorebooks" | "authors" | "blocked" | "import" | "settings" | "logout" | "menu" | "chevron";

export const primaryNavigation = [
  { href: "/", label: "Fresh", icon: "home" as const },
  { href: "/characters", label: "Characters", icon: "characters" as const },
  { href: "/authors", label: "Authors", icon: "authors" as const },
  { href: "/lorebooks", label: "Lorebooks", icon: "lorebooks" as const },
];

type ManagementGroupDefinition = {
  label: string;
  links: Array<{ href: string; label: string }>;
};

const managementGroups: ManagementGroupDefinition[] = [
  { label: "Import", links: [{ href: "/import", label: "Import character" }] },
  { label: "Library", links: [{ href: "/characters", label: "Characters" }, { href: "/lorebooks", label: "Lorebooks" }, { href: "/authors", label: "Authors" }] },
  {
    label: "Moderation",
    links: [
      { href: "/blocked", label: "Blocked overview" },
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
    home: <><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></>,
    characters: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 4v16M8 9h13" /></>,
    lorebooks: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z" /><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5v-16Z" /></>,
    authors: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><circle cx="17" cy="9" r="2.5" /><path d="M15 14.5a4.5 4.5 0 0 1 5.5 4.5" /></>,
    blocked: <><circle cx="12" cy="12" r="9" /><path d="m5.7 5.7 12.6 12.6" /></>,
    import: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19 15.5a7.8 7.8 0 0 0 .1-1.5l2-1.5-2-3.5-2.5 1A7 7 0 0 0 14 8.5L13.5 6h-4L9 8.5A7 7 0 0 0 6.4 10L4 9l-2 3.5L4 14a7.8 7.8 0 0 0 .1 1.5L2.5 17l2 3.5 2.3-1A7 7 0 0 0 9 20.7l.5 2.3h4l.5-2.3a7 7 0 0 0 2.2-1.2l2.3 1 2-3.5-1.5-1.5Z" /></>,
    logout: <><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
  };
  return <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export function managementGroupsForRole(role: UserRole): ManagementGroupDefinition[] {
  return role === "ADMIN" ? managementGroups : managementGroups.slice(0, 2);
}

export function DashboardNav({ role = "ADMIN" }: { role?: UserRole }) {
  const pathname = usePathname();
  return <DashboardNavForPath key={pathname} pathname={pathname} role={role} />;
}

type TransientHeaderState = {
  addManageOpen: boolean;
  mobileMenuOpen: boolean;
};

type TransientHeaderAction =
  | { type: "set-add-manage"; open: boolean }
  | { type: "set-mobile-menu"; open: boolean }
  | { type: "dismiss" };

const closedTransientHeaderState: TransientHeaderState = {
  addManageOpen: false,
  mobileMenuOpen: false,
};

export function transientHeaderReducer(
  state: TransientHeaderState,
  action: TransientHeaderAction,
): TransientHeaderState {
  if (action.type === "dismiss") return closedTransientHeaderState;
  if (action.type === "set-add-manage") {
    return { addManageOpen: action.open, mobileMenuOpen: action.open ? false : state.mobileMenuOpen };
  }
  return { addManageOpen: action.open ? false : state.addManageOpen, mobileMenuOpen: action.open };
}

function DashboardNavForPath({ pathname, role }: { pathname: string; role: UserRole }) {
  const [transientState, dispatch] = useReducer(transientHeaderReducer, closedTransientHeaderState);
  const { favoriteCount, cartCount } = useCharacterCollections();
  const dismissTransientMenus = () => dispatch({ type: "dismiss" });

  return (
    <>
      <div className="font-interface hidden items-center justify-between lg:flex">
        <nav aria-label="Primary" className="flex items-center gap-1">
          <ManagementMenu
            groups={managementGroupsForRole(role)}
            open={transientState.addManageOpen}
            onOpenChange={(open) => dispatch({ type: "set-add-manage", open })}
            onNavigate={dismissTransientMenus}
          />
          {primaryNavigation.map((item) => <PrimaryLink key={item.href} {...item} active={isNavigationItemActive(pathname, item.href)} onNavigate={dismissTransientMenus} />)}
        </nav>
        <div className="flex items-center gap-1.5">
          <CollectionLink href="/favorites" label="Favorites" icon="favorite" count={favoriteCount} active={isUtilityRouteActive(pathname, "/favorites")} onNavigate={dismissTransientMenus} />
          <CollectionLink href="/cart" label="Cart" icon="cart" count={cartCount} active={isUtilityRouteActive(pathname, "/cart")} onNavigate={dismissTransientMenus} />
          <span className="mr-1 flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/50 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Private</span>
          {role === "ADMIN" && <SettingsLink active={isUtilityRouteActive(pathname, "/settings")} onNavigate={dismissTransientMenus} />}
          <LogoutButton compact />
        </div>
      </div>
      <div className="font-interface flex items-center justify-end gap-0.5 lg:hidden">
        <nav aria-label="Mobile primary shortcuts" className="flex items-center gap-0.5">
          {primaryNavigation.map((item) => <PrimaryLink key={item.href} {...item} active={isNavigationItemActive(pathname, item.href)} compact onNavigate={dismissTransientMenus} />)}
        </nav>
        <details
          open={transientState.mobileMenuOpen}
          onToggle={(event) => dispatch({ type: "set-mobile-menu", open: event.currentTarget.open })}
          className="group relative"
        >
          <summary aria-expanded={transientState.mobileMenuOpen} className="archive-focus grid h-9 w-9 cursor-pointer list-none place-items-center rounded-lg border border-zinc-800 bg-zinc-900/65 text-zinc-300 marker:hidden hover:bg-zinc-800 hover:text-zinc-50" aria-label="Open application menu"><NavIcon name="menu" /></summary>
          <div className="archive-surface absolute right-0 top-11 w-[min(22rem,calc(100vw-2rem))] rounded-xl border p-2.5 shadow-2xl shadow-black/40">
            <nav aria-label="Mobile primary" className="grid gap-1">
              {primaryNavigation.map((item) => <PrimaryLink key={item.href} {...item} active={isNavigationItemActive(pathname, item.href)} onNavigate={dismissTransientMenus} />)}
            </nav>
            <div className="my-2 border-t border-zinc-800" />
            <nav aria-label="Collections" className="grid grid-cols-2 gap-1">
              <CollectionLink href="/favorites" label="Favorites" icon="favorite" count={favoriteCount} active={isUtilityRouteActive(pathname, "/favorites")} onNavigate={dismissTransientMenus} expanded />
              <CollectionLink href="/cart" label="Cart" icon="cart" count={cartCount} active={isUtilityRouteActive(pathname, "/cart")} onNavigate={dismissTransientMenus} expanded />
            </nav>
            <div className="my-2 border-t border-zinc-800" />
            <div className="grid grid-cols-2 gap-x-2 gap-y-1">
              {managementGroupsForRole(role).map((group) => <ManagementGroup key={group.label} group={group} onNavigate={dismissTransientMenus} />)}
            </div>
            <div className="my-2 border-t border-zinc-800" />
            <LogoutButton />
          </div>
        </details>
      </div>
    </>
  );
}

function PrimaryLink({ href, label, icon, active, compact = false, onNavigate }: { href: string; label: string; icon: IconName; active: boolean; compact?: boolean; onNavigate?: () => void }) {
  return <Link href={href} onClick={onNavigate} aria-current={active ? "page" : undefined} aria-label={compact ? label : undefined} title={compact ? label : undefined} className={`archive-focus flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${compact ? "px-2.5" : ""} ${active ? "accent-muted border" : "border border-transparent text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"}`}><NavIcon name={icon} />{compact ? <span className="sr-only">{label}</span> : label}</Link>;
}

function CollectionLink({ href, label, icon, count, active, onNavigate, expanded = false }: {
  href: "/favorites" | "/cart";
  label: "Favorites" | "Cart";
  icon: "favorite" | "cart";
  count: number;
  active: boolean;
  onNavigate: () => void;
  expanded?: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={`${label}${count > 0 ? ` ${count}` : ""}`}
      title={`${label}${count > 0 ? ` ${count}` : ""}`}
      data-active={active || undefined}
      className={expanded ? "header-collection-link header-collection-link-expanded archive-focus" : "header-collection-link archive-focus"}
    >
      <CollectionIcon name={icon} active={active} />
      <span>{label}</span>
      {count > 0 && <strong>{count}</strong>}
    </Link>
  );
}

function ManagementMenu({ groups, open, onOpenChange, onNavigate }: { groups: ManagementGroupDefinition[]; open: boolean; onOpenChange: (open: boolean) => void; onNavigate: () => void }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!detailsRef.current?.contains(event.target as Node)) onOpenChange(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onOpenChange(false);
      summaryRef.current?.focus();
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onOpenChange, open]);

  return (
    <details
      ref={detailsRef}
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
      className="group relative mr-1"
      data-state={managementActionState(open)}
    >
      <summary
        ref={summaryRef}
        aria-expanded={open}
        className="management-action archive-focus"
      >
        <span className="management-action-plus" aria-hidden="true">＋</span>
        <span>Add &amp; Manage</span>
        <span className="management-action-arrow transition group-open:rotate-90"><NavIcon name="chevron" /></span>
      </summary>
      <div className="archive-surface absolute left-0 top-11 grid w-[30rem] grid-cols-2 gap-x-2 gap-y-1 rounded-xl border p-2.5 shadow-2xl shadow-black/40">
        {groups.map((group) => <ManagementGroup key={group.label} group={group} onNavigate={onNavigate} />)}
      </div>
    </details>
  );
}

function ManagementGroup({ group, onNavigate }: { group: ManagementGroupDefinition; onNavigate?: () => void }) {
  return <div className="rounded-lg p-2"><p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-violet-400">{group.label}</p><div className="grid gap-0.5">{group.links.map((link) => <Link key={link.href} href={link.href} onClick={onNavigate} className="archive-focus rounded-md px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">{link.label}</Link>)}</div></div>;
}

function LogoutButton({ compact = false }: { compact?: boolean }) {
  return <form action="/api/auth/logout" method="post"><button type="submit" aria-label={compact ? "Logout" : undefined} title={compact ? "Logout" : undefined} className={compact ? "header-utility-control archive-focus" : "archive-focus flex w-full items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-xs font-medium text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"}><NavIcon name="logout" />{compact ? <span className="sr-only">Logout</span> : "Logout"}</button></form>;
}

function SettingsLink({ active, onNavigate }: { active: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href="/settings"
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label="Settings"
      title="Settings"
      data-active={active || undefined}
      className="header-utility-control archive-focus"
    >
      <NavIcon name="settings" />
      <span className="sr-only">Settings</span>
    </Link>
  );
}

export function isNavigationItemActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}

export function isUtilityRouteActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function managementActionState(open: boolean): "open" | "closed" {
  return open ? "open" : "closed";
}
