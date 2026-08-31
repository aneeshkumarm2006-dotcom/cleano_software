"use client";

import { useState, useEffect, useLayoutEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Menu,
  X,
  ChevronDown,
  MessageCircle,
  LayoutDashboard,
  BarChart3,
  TrendingUp,
  CalendarDays,
  CalendarClock,
  Briefcase,
  Inbox,
  Clock,
  FileSignature,
  Contact,
  Globe,
  Flame,
  Users,
  UsersRound,
  UserPlus,
  Package,
  Droplets,
  MapPin,
  FileText,
  Gift,
  Wallet,
  Receipt,
  Banknote,
  ScrollText,
  Settings,
  LogOut,
  Sparkles,
  IdCard,
  LineChart,
  Database,
  GraduationCap,
  Megaphone,
  type LucideIcon,
} from "lucide-react";
import type { UnreadChatCount } from "@/lib/chatUnread";
import ScrollReset from "@/components/ScrollReset";
import { useJobChatUnread } from "@/components/JobChatUnread";
import { useAdminAttentionCounts } from "@/components/AdminAttentionCounts";

interface User {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
}

interface SidebarProps {
  user: User;
  signOutAction: () => Promise<void>;
  children: React.ReactNode;
}

/**
 * Which count feeds an item's pill. `chat` and `jobChat` are unread-message
 * counts with their own read-tracking; the rest are STATUS-BASED queues served
 * by `getAdminAttentionCounts` — they clear when an admin advances the row's
 * status, so no read-marker infrastructure was needed (awerfixes.pdf item 11).
 */
type Badge =
  | "chat"
  | "requests"
  | "jobChat"
  | "applications"
  | "quotes"
  | "documents"
  | "leads"
  | "payouts"
  | "inventory";
interface NavItem {
  href: string;
  label: string;
  Icon: LucideIcon;
  badge?: Badge;
  exclude?: string[];
  // Extra paths that keep this item highlighted (e.g. the Messages entry
  // covers both /admin/chat and /admin/group-chat sub-tabs).
  also?: string[];
  /**
   * The destination page redirects anyone who isn't OWNER/ADMIN, so the link is
   * hidden from OPS_MANAGER / FIELD_LEAD. Mirrors the guard inside each
   * `page.tsx` — the nav must not advertise pages that bounce the user, and it
   * shouldn't disclose what exists to roles that can't open it.
   *
   * Keep this in sync when a page's own role gate changes.
   */
  adminOnly?: boolean;
  /**
   * Shown only to a FIELD_LEAD. The mirror image of `adminOnly`: /admin/my-team
   * is a Field Lead's own group view, so an OPS_MANAGER has no team there and an
   * OWNER/ADMIN reaches it through a lead picker rather than through the nav.
   *
   * `adminOnly` and this are mutually exclusive by construction — a page cannot
   * be both OWNER/ADMIN-only and FIELD_LEAD-only.
   */
  fieldLeadOnly?: boolean;
  /**
   * Stamped onto the link as `data-tour`, so the guided tour can point at this
   * entry without matching on an href or a label.
   *
   * A tour step that hunts for `a[href="/admin/jobs"]` breaks the day somebody
   * moves the route, and it breaks silently — the spotlight simply lands on
   * nothing. Only the handful of entries the tour actually visits carry one.
   */
  tour?: string;
}

const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [
      { href: "/admin/dashboard", label: "Dashboard", Icon: LayoutDashboard },
      {
        href: "/admin/analytics",
        label: "Analytics",
        Icon: BarChart3,
        adminOnly: true,
      },
      { href: "/admin/kpi", label: "KPIs", Icon: TrendingUp },
      { href: "/admin/calendar", label: "Calendar", Icon: CalendarDays, tour: "calendar" },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        href: "/admin/contacts",
        label: "Contacts",
        Icon: IdCard,
        adminOnly: true,
      },
      {
        href: "/admin/jobs",
        label: "Jobs",
        tour: "jobs",
        Icon: Briefcase,
        // Unread cleaner↔client messages across live jobs (CLN-P0-3-08).
        badge: "jobChat",
      },
      {
        href: "/admin/requests",
        label: "Requests",
        Icon: Inbox,
        badge: "requests",
      },
      {
        href: "/admin/waitlist",
        label: "Wait Lists",
        Icon: Clock,
        adminOnly: true,
      },
      {
        href: "/admin/documents",
        label: "Documents",
        Icon: FileSignature,
        // The VIEWER'S own unsigned documents. This page is a personal signing
        // queue, not an org-wide view, so the badge counts what clicking it
        // actually shows.
        badge: "documents",
      },
      {
        href: "/admin/clients",
        label: "Clients",
        tour: "clients",
        Icon: Contact,
        adminOnly: true,
      },
      {
        href: "/admin/web-bookings",
        label: "Web Bookings",
        tour: "webBookings",
        Icon: Globe,
        // Prints real booking totals — see the guard on its page.
        adminOnly: true,
      },
      // Leads used to sit here. It belongs to the sales funnel, not to daily
      // operations (client feedback item 2) — see the Sales & Marketing group.
      // Item 24: one communication entry — direct messages + group chat live
      // behind sub-tabs on the chat pages.
      {
        href: "/admin/chat",
        label: "Messages",
        Icon: MessageCircle,
        badge: "chat",
        also: ["/admin/group-chat"],
        adminOnly: true,
      },
    ],
  },
  {
    label: "Staff",
    items: [
      {
        href: "/admin/employees",
        label: "Employees",
        tour: "employees",
        Icon: Users,
        adminOnly: true,
      },
      // Stage 12 / PDF #12 — the all-cleaner availability view. Sits next to
      // Employees because it is the same roster read a different way, and the
      // Employees page's own collapsed grid was retired in its favour.
      {
        href: "/admin/availability",
        label: "Availability",
        Icon: CalendarClock,
        adminOnly: true,
      },
      // Stage 7 / PDF #7. Leads the Staff group for a Field Lead because it is
      // the only group-scoped view they have — Employees, which would sit here
      // for an admin, bounces them.
      {
        href: "/admin/my-team",
        label: "My Team",
        Icon: UsersRound,
        fieldLeadOnly: true,
      },
      { href: "/admin/time-tracking", label: "Time Tracking", Icon: Clock },
      {
        href: "/admin/job-applications",
        label: "Job Applications",
        Icon: UserPlus,
        badge: "applications",
      },
      {
        href: "/admin/training-docs",
        label: "Training & Docs",
        Icon: GraduationCap,
      },
      {
        href: "/admin/announcements",
        label: "Announcements",
        Icon: Megaphone,
        adminOnly: true,
      },
    ],
  },
  {
    label: "Inventory & Supplies",
    items: [
      {
        href: "/admin/inventory",
        label: "Inventory",
        Icon: Package,
        // Cleaner supply requests awaiting a resolve — the same PENDING count
        // the page's own Requests tab shows.
        badge: "inventory",
        adminOnly: true,
      },
      { href: "/admin/wash-payouts", label: "Wash Payouts", Icon: Droplets,
        // Prints payout totals — see the guard on its page.
        adminOnly: true,
      },
    ],
  },
  {
    label: "Sales & Marketing",
    items: [
      // Moved out of Operations (item 2) — "putting the hot lead section under
      // sales rather than under operations". Leads the group because it is the
      // top of the funnel the rest of this section works through.
      {
        href: "/admin/leads",
        label: "Leads",
        Icon: Flame,
        badge: "leads",
        adminOnly: true,
      },
      {
        href: "/admin/sales",
        label: "Sales Leads",
        Icon: MapPin,
        adminOnly: true,
      },
      {
        href: "/admin/reports",
        label: "Lead Source & CPA",
        Icon: LineChart,
        adminOnly: true,
      },
      {
        href: "/admin/quotes",
        label: "Quotes",
        Icon: FileText,
        badge: "quotes",
      },
      {
        href: "/admin/gift-cards",
        label: "Gift Cards & Promos",
        Icon: Gift,
        // Prints outstanding/redeemed balances — see the guard on its page.
        adminOnly: true,
      },
    ],
  },
  {
    label: "Finance",
    items: [
      {
        href: "/admin/payouts",
        label: "Payouts",
        Icon: Wallet,
        // Pay periods sitting in PENDING_APPROVAL. Withdrawals have their own
        // PENDING state on the same page; deliberately not folded in, so the
        // number means one thing ("periods waiting on you") rather than two.
        badge: "payouts",
        adminOnly: true,
      },
      {
        href: "/admin/finances",
        label: "Finances",
        tour: "finances",
        Icon: Receipt,
        adminOnly: true,
      },
      {
        href: "/admin/invoices",
        label: "Invoices",
        Icon: FileText,
        adminOnly: true,
      },
      {
        href: "/admin/bulk-charge",
        label: "Bulk Charge",
        Icon: Banknote,
        adminOnly: true,
      },
    ],
  },
  {
    label: "Admin",
    items: [
      {
        href: "/admin/properties",
        label: "Property Engine",
        Icon: Database,
        adminOnly: true,
      },
      {
        href: "/admin/logs",
        label: "Logs",
        Icon: ScrollText,
        adminOnly: true,
      },
      {
        href: "/admin/settings",
        label: "Settings",
        tour: "settings",
        Icon: Settings,
        adminOnly: true,
      },
    ],
  },
];

/**
 * Collapse state for the seven nav groups (client feedback item 1 — "this
 * should be a drop-down menu rather than a scroll-down"). Stored as
 * `{ [sectionLabel]: true }` for the CLOSED ones only, so a group added later
 * defaults to open rather than inheriting a stale key.
 */
const SIDEBAR_COLLAPSE_KEY = "cleano.admin.sidebar.collapsed";

/**
 * Gap between staff-chat unread polls, measured from the END of one to the
 * START of the next. See the effect that uses it for why it is 30s and not the
 * 5s it used to be.
 */
const CHAT_UNREAD_POLL_MS = 30_000;

/** Every group label the preference may legitimately mention. */
const SIDEBAR_SECTION_LABELS = NAV.map((s) => s.label);

/**
 * The restore has to happen in the COMMIT phase, not in a passive effect.
 *
 * The server has no localStorage, so the first client render must reproduce the
 * server's markup (everything expanded) or hydration mismatches. A layout
 * effect satisfies both halves: it runs after that hydration commit but
 * synchronously *before the browser paints*, so the admin never sees a flash of
 * the wrong state — and, more importantly, it has run before any click on a
 * section header is physically possible. That is what lets the `loaded` flag go
 * away entirely: there is no longer a window in which a toggle can fire against
 * an un-restored placeholder and write it back over the saved preference.
 * (Restoring from a passive effect is what QA measured never committing, which
 * left every first click after a reload wiping the stored JSON.)
 */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

function readCollapsedSections(validLabels: string[]): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const label of validLabels) {
      if ((parsed as Record<string, unknown>)[label] === true) out[label] = true;
    }
    return out;
  } catch {
    // Private mode, quota, or hand-edited junk — an unreadable preference must
    // never cost the admin their navigation.
    return {};
  }
}

function writeCollapsedSections(sections: Record<string, boolean>): void {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSE_KEY, JSON.stringify(sections));
  } catch {
    // Private mode or quota — collapsing still works for this session, the
    // preference just doesn't survive the reload.
  }
}

function sectionDomId(label: string): string {
  return `anav-sect-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}
function roleLabel(role: string): string {
  return role
    ? role.charAt(0) + role.slice(1).toLowerCase().replace("_", " ")
    : "Staff";
}

export default function Sidebar({
  user,
  signOutAction,
  children,
}: SidebarProps) {
  // The admin area admits OWNER, ADMIN, OPS_MANAGER and FIELD_LEAD, but many
  // pages redirect all but the first two. Build the nav from the viewer's real
  // role so it never links somewhere they'll be bounced from.
  //
  // Note this is presentation only — each page keeps its own server-side guard,
  // which is what actually enforces access.
  const isOwnerAdmin = user.role === "OWNER" || user.role === "ADMIN";
  const isFieldLead = user.role === "FIELD_LEAD";
  const visibleNav = NAV.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) =>
        (!item.adminOnly || isOwnerAdmin) &&
        (!item.fieldLeadOnly || isFieldLead)
    ),
    // A section with nothing the viewer can open is hidden entirely rather than
    // left as an empty heading.
  })).filter((section) => section.items.length > 0);

  const [mobileOpen, setMobileOpen] = useState(false);
  // Starts empty — i.e. everything expanded, exactly what the server rendered —
  // and is replaced from localStorage in the layout effect below. Reading
  // storage in a lazy initializer would render different markup on the client
  // and trip hydration.
  //
  // There is no `loaded` flag any more. It existed so that a toggle firing
  // before the restore could take a different path, and that branch was the bug
  // (QA: the first click after a reload wiped the saved preference). The
  // restore now runs before paint, so `collapsedRef.current` is authoritative
  // from the first frame and there is only one path.
  const [collapsedSections, setCollapsedSections] = useState<
    Record<string, boolean>
  >({});
  // Mirror of the above, so handlers and effects can read the CURRENT value
  // without being re-created or re-subscribed when it changes.
  const collapsedRef = useRef<Record<string, boolean>>(collapsedSections);
  const pathname = usePathname();
  const [chatUnread, setChatUnread] = useState(0);
  // Job chat (cleaner ↔ client) unread, shared with any list on the page.
  const { total: jobChatUnread } = useJobChatUnread("admin");
  // Every status-based queue count, one request every 30s (item 11). Replaces
  // the 5s `getPendingRequestCount` poller that used to live below.
  const attention = useAdminAttentionCounts();
  const [chatToast, setChatToast] = useState<{
    senderName: string;
    body: string;
  } | null>(null);
  const prevLatestAtRef = useRef<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [mobileOpen]);

  useEffect(() => {
    pathnameRef.current = pathname;
    if (pathname.startsWith("/admin/chat")) setChatToast(null);
  }, [pathname]);

  // Poll unread chat + toast on new messages.
  //
  // A PLAIN GET, not a server action. This is the whole of round 5's K1.
  //
  // Round 4 made this loop self-pacing, which stopped the queue growing without
  // bound but did not stop the damage: `getUnreadChatCount` was a SERVER ACTION,
  // and a Next.js server action's response carries an RSC re-render of whatever
  // route the caller is standing on. This poll is mounted in the sidebar, so
  // that route is EVERY admin page. QA measured 5 POSTs to /admin/analytics in a
  // 30 s IDLE window, each costing ~6 s of remote database time, and clicking an
  // industry chip on that page then failed to commit in 3 of 4 trials — the RSC
  // payload for the new URL came back 200 every time, but a concurrent render
  // restarted every few seconds and the pending `router.replace` transition
  // never got to commit. Navigating to the same URL directly always worked.
  //
  // A GET route handler returns JSON and re-renders nothing, so the poll can no
  // longer interfere with a navigation the admin actually asked for. It is still
  // self-paced (the next call is queued when this one finishes, including on
  // failure) so it can never outrun its own work on a slow connection.
  //
  // 30 s, not 5 s. One poll is two queries against a pooler with 1.7-3.5 s round
  // trips; a 5 s beat spent most of every minute in flight. The cost is that the
  // "new message" toast can be up to 30 s late — acceptable for a passive
  // notification, and the chat page itself still polls its thread every 3 s.
  //
  // Hidden tabs don't poll at all, and coming back to the tab polls immediately
  // rather than waiting out the remaining interval.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Guards the visibility handler below from starting a SECOND self-pacing
    // chain on top of one that is mid-flight.
    let inFlight = false;

    async function poll() {
      if (cancelled || inFlight) return;
      inFlight = true;
      if (
        typeof document === "undefined" ||
        document.visibilityState === "visible"
      ) {
        try {
          const res = await fetch("/api/chat/unread", {
            credentials: "include",
            cache: "no-store",
          });
          if (!res.ok) throw new Error(`chat unread ${res.status}`);
          const { count, latest } = (await res.json()) as UnreadChatCount;
          if (cancelled) {
            inFlight = false;
            return;
          }
          setChatUnread(count);
          const latestAt = latest?.at ?? "";
          const isInitialized = prevLatestAtRef.current !== null;
          const hasNew =
            isInitialized &&
            latestAt !== "" &&
            latestAt !== prevLatestAtRef.current;
          if (hasNew && !pathnameRef.current.startsWith("/admin/chat")) {
            setChatToast({
              senderName: latest!.senderName,
              body: latest!.body,
            });
            if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
            toastTimerRef.current = setTimeout(() => setChatToast(null), 5000);
          }
          prevLatestAtRef.current = latestAt;
        } catch {
          /* ignore — an erroring poll must still keep the badge alive */
        }
      }
      inFlight = false;
      if (!cancelled) timer = setTimeout(poll, CHAT_UNREAD_POLL_MS);
    }

    function onVisibility() {
      if (cancelled || document.visibilityState !== "visible") return;
      // A poll already running will schedule the next one itself; cancelling the
      // (non-existent) timer here and calling `poll()` into the `inFlight` guard
      // would kill the chain.
      if (inFlight) return;
      // Otherwise refresh the badge the moment the admin comes back, instead of
      // showing a count that could be a whole interval stale.
      if (timer) clearTimeout(timer);
      timer = null;
      poll();
    }

    poll();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  function isActive(item: NavItem): boolean {
    if (
      item.exclude?.some((p) => pathname === p || pathname.startsWith(p + "/"))
    ) {
      return false;
    }
    if (
      item.also?.some((p) => pathname === p || pathname.startsWith(p + "/"))
    ) {
      return true;
    }
    return pathname === item.href || pathname.startsWith(item.href + "/");
  }

  // ── Collapsible nav groups (item 1) ────────────────────────────────────────
  // The group holding the current page. Recomputed every render because
  // `isActive` reads `pathname`.
  const activeSectionLabel = visibleNav.find((s) => s.items.some(isActive))
    ?.label;

  /** Single write path: ref first (so the next handler reads it), then state, then disk. */
  function applyCollapsed(next: Record<string, boolean>, persist: boolean) {
    collapsedRef.current = next;
    setCollapsedSections(next);
    if (persist) writeCollapsedSections(next);
  }

  // Restore the saved state BEFORE the first paint (see
  // `useIsomorphicLayoutEffect` above), and open the group the admin has landed
  // in while we are here — that is the same moment, and doing it in one place
  // means the auto-expand no longer has to wait for a restore flag it might
  // never see.
  //
  // `activeSectionLabel` is read from the first render's closure on purpose:
  // this runs once, and the group being landed in is by definition the one that
  // was active on that render. Later navigations are handled by the effect
  // below.
  useIsomorphicLayoutEffect(() => {
    const sections = readCollapsedSections(SIDEBAR_SECTION_LABELS);
    const landedCollapsed = !!activeSectionLabel && !!sections[activeSectionLabel];
    if (landedCollapsed) delete sections[activeSectionLabel!];
    applyCollapsed(sections, landedCollapsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Whatever was saved, the group you navigate INTO opens. Keyed on the section
  // rather than the pathname so moving between pages inside one group can't
  // re-open a group you just closed, and reading the ref rather than depending
  // on the state so collapsing the group you are standing in doesn't
  // immediately re-open it under your cursor.
  useEffect(() => {
    if (!activeSectionLabel) return;
    const current = collapsedRef.current;
    if (!current[activeSectionLabel]) return;
    const sections = { ...current };
    delete sections[activeSectionLabel];
    applyCollapsed(sections, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSectionLabel]);

  // Persist AT THE POINT OF CHANGE, not from an effect watching the state.
  //
  // An earlier version wrote from a `useEffect([collapse])` gated on a `loaded`
  // flag, so every write was downstream of the restore having committed first,
  // and a toggle that ran while that flag was still false was silently lost.
  // The fix for that added a read-through branch for the same window, which QA
  // then measured actively DESTROYING the preference: the restore was not
  // committing at all, so the first click after every reload took the branch,
  // toggled the stored `{"Finance":true}` back off, and wrote `{}`.
  //
  // Both were symptoms of the restore being racy. It no longer is — it runs in
  // the commit phase, before any click is possible — so this has exactly one
  // path and no flag to consult.
  function toggleSection(label: string) {
    const sections = { ...collapsedRef.current };
    if (sections[label]) delete sections[label];
    else sections[label] = true;
    applyCollapsed(sections, true);
  }

  // One lookup instead of a ternary chain, so the next badge is a NAV entry plus
  // a line here rather than another rung. `Record<Badge, number>` is exhaustive —
  // adding a key to the union without a count is a compile error, which is the
  // point: a badge that silently renders 0 forever is worse than no badge.
  const badgeCounts: Record<Badge, number> = {
    chat: chatUnread,
    jobChat: jobChatUnread,
    requests: attention.requests,
    applications: attention.applications,
    quotes: attention.quotes,
    documents: attention.documents,
    leads: attention.leads,
    payouts: attention.payouts,
    inventory: attention.inventory,
  };

  return (
    <div className="min-h-[100dvh]" style={{ background: "var(--cream)" }}>
      {/* Mobile hamburger */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
        aria-expanded={mobileOpen}
        className="md:hidden fixed top-4 left-4 z-30 p-2.5 rounded-xl bg-white/80 backdrop-blur-md shadow-md text-[#008C9C] hover:bg-white transition-colors print:hidden"
      >
        <Menu className="w-6 h-6" />
      </button>

      {/* Mobile backdrop */}
      <div
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
        className={`md:hidden fixed inset-0 bg-black/40 z-40 transition-opacity duration-300 print:hidden ${
          mobileOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      />

      {/* Sidebar rail */}
      <aside
        className={`asidebar-rail fixed left-0 top-0 bottom-0 w-[240px] z-50 transition-transform duration-300 ease-in-out print:hidden ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0`}
      >
        {/* Logo */}
        <div className="asidebar-logo">
          <Link
            href="/admin/dashboard"
            className="flex items-center gap-2 min-w-0"
          >
            <span className="logo-mark-dark">
              <Sparkles size={16} strokeWidth={2} />
            </span>
            <span className="logo-word">cleano</span>
            <span className="logo-badge">Admin</span>
          </Link>
          {mobileOpen && (
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
              className="ml-auto p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-[18px] pr-0.5">
          {visibleNav.map((section) => {
            const open = !collapsedSections[section.label];
            const panelId = sectionDomId(section.label);
            // A closed group must not swallow the thing a badge is shouting
            // about, so its pills roll up onto the header.
            const hiddenBadgeTotal = open
              ? 0
              : section.items.reduce(
                  (sum, item) =>
                    sum + (item.badge ? badgeCounts[item.badge] : 0),
                  0,
                );
            return (
              <div className="asidebar-section" key={section.label}>
                <button
                  type="button"
                  className="asidebar-section-label asidebar-section-toggle"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => toggleSection(section.label)}
                >
                  <span className="asidebar-section-name">{section.label}</span>
                  {hiddenBadgeTotal > 0 && (
                    <span className="anav-count alert">
                      {hiddenBadgeTotal > 99 ? "99+" : hiddenBadgeTotal}
                    </span>
                  )}
                  <ChevronDown
                    size={13}
                    strokeWidth={2.5}
                    className="asidebar-section-chev"
                    aria-hidden="true"
                  />
                </button>
                <div
                  id={panelId}
                  className="asidebar-section-items"
                  hidden={!open}
                >
                  {section.items.map((item) => {
                    const active = isActive(item);
                    const badgeCount = item.badge ? badgeCounts[item.badge] : 0;
                    const Icon = item.Icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        data-tour={item.tour}
                        className={`anav-item ${active ? "active" : ""}`}
                      >
                        <Icon size={16} strokeWidth={1.7} />
                        <span className="anav-label">{item.label}</span>
                        {badgeCount > 0 && (
                          <span className="anav-count alert">
                            {badgeCount > 99 ? "99+" : badgeCount}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="asidebar-user">
          <span className="asidebar-avatar">{initialsOf(user.name)}</span>
          <div className="asidebar-user-meta">
            <strong>{user.name}</strong>
            <span>{roleLabel(user.role)}</span>
          </div>
          <button
            type="button"
            className="asidebar-signout"
            aria-label="Sign out"
            onClick={() => signOutAction()}
          >
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      {/* Main content.
          100dvh, not 100vh: on iOS Safari `vh` measures the viewport *behind*
          the address bar and toolbar, so every admin page reserved ~60–115px of
          height under Safari's chrome. Pages that scroll hid it; the chat shell,
          which fills its box exactly, clipped its composer instead. */}
      <div
        data-scroll-reset
        className="md:ml-[240px] h-[100dvh] overflow-hidden overflow-y-auto print:!ml-0 print:!h-auto print:!overflow-visible"
        style={{ background: "var(--cream)" }}
      >
        <ScrollReset />
        <main className="h-full print:!h-auto">{children}</main>
      </div>

      {/* Chat notification toast */}
      {chatToast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            zIndex: 300,
            maxWidth: 340,
            width: "calc(100vw - 48px)",
            animation: "chat-toast-in 0.25s ease-out",
          }}
        >
          <style>{`
            @keyframes chat-toast-in {
              from { opacity: 0; transform: translateY(12px) scale(0.97); }
              to   { opacity: 1; transform: translateY(0)    scale(1); }
            }
          `}</style>
          <div
            style={{
              background: "#008C9C",
              borderRadius: 16,
              boxShadow:
                "0 8px 32px rgba(0,140,156,0.35), 0 2px 8px rgba(0,0,0,0.12)",
              padding: "14px 16px",
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "rgba(255,255,255,0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <MessageCircle size={18} color="#fff" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#fff",
                  margin: 0,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {chatToast.senderName}
              </p>
              <p
                style={{
                  fontSize: 12,
                  color: "rgba(255,255,255,0.75)",
                  margin: "3px 0 8px",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {chatToast.body}
              </p>
              <a
                href="/admin/chat"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#fff",
                  textDecoration: "none",
                  opacity: 0.9,
                }}
                onClick={() => setChatToast(null)}
              >
                Open Chat →
              </a>
            </div>
            <button
              type="button"
              onClick={() => setChatToast(null)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 4,
                color: "rgba(255,255,255,0.6)",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
