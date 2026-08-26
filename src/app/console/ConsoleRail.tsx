"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = {
  href: string;
  label: string;
  icon: React.ReactNode;
  count?: number;
  alert?: boolean;
};

/**
 * The console's navigation.
 *
 * A client component only because the current page has to be highlighted, which
 * is the one thing the server cannot know per-link. Every count is passed in
 * from the server so the rail can never show a different number than the page
 * it links to.
 */
export default function ConsoleRail({
  staffName,
  staffRole,
  workspaces,
  trials,
  needsBilling,
  requests,
  staffCount,
}: {
  staffName: string;
  staffRole: string;
  workspaces: number;
  trials: number;
  needsBilling: number;
  requests: number;
  staffCount: number;
}) {
  const path = usePathname();

  const operate: Item[] = [
    {
      href: "/console",
      label: "Overview",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 13h6V4H4zM14 8h6V4h-6zM14 20h6v-9h-6zM4 20h6v-4H4z" />
        </svg>
      ),
    },
    {
      href: "/console/workspaces",
      label: "Workspaces",
      count: workspaces,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h2m-2 4h2m4-4h2m-2 4h2M9 21v-4h6v4" />
        </svg>
      ),
    },
    {
      href: "/console/billing",
      label: "Billing",
      count: needsBilling || undefined,
      alert: needsBilling > 0,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      ),
    },
  ];

  const growth: Item[] = [
    {
      href: "/console/trials",
      label: "Trials",
      count: trials || undefined,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
      ),
    },
    {
      href: "/console/requests",
      label: "Access requests",
      count: requests || undefined,
      // Somebody is sitting unanswered, which is worth the same weight as a
      // failed payment.
      alert: requests > 0,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
        </svg>
      ),
    },
  ];

  const platform: Item[] = [
    {
      href: "/console/audit",
      label: "Audit log",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2m-6 8h6m-6 4h4" />
        </svg>
      ),
    },
    {
      href: "/console/staff",
      label: "Staff access",
      count: staffCount,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      href: "/console/health",
      label: "System health",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" />
          <path d="M7 12h3l2-4 2 8 2-4h1" />
        </svg>
      ),
    },
  ];

  // "/console" must not light up on every child route, but "/console/workspaces"
  // should stay lit while a single workspace is open.
  const isCurrent = (href: string) =>
    href === "/console" ? path === "/console" : path.startsWith(href);

  const render = (items: Item[]) =>
    items.map((it) => (
      <Link
        key={it.href}
        href={it.href}
        className="navitem"
        aria-current={isCurrent(it.href) ? "page" : undefined}
      >
        {it.icon}
        {it.label}
        {it.count != null && (
          <span className={it.alert ? "count alert" : "count"}>{it.count}</span>
        )}
      </Link>
    ));

  const initials = staffName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <nav className="rail" aria-label="Console">
      <div className="brandmark">
        <div className="dot">A</div>
        <div>
          <b>Awer</b>
          <span>Console</span>
        </div>
      </div>

      <div className="navlabel">Operate</div>
      {render(operate)}

      <div className="navlabel">Growth</div>
      {render(growth)}

      <div className="navlabel">Platform</div>
      {render(platform)}

      <div className="rail-foot">
        <div className="who">
          <div className="av">{initials}</div>
          <div>
            {staffName}
            <small>Platform {staffRole.toLowerCase()}</small>
          </div>
        </div>
      </div>
    </nav>
  );
}
