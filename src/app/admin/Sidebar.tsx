"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Menu,
  X,
  MessageCircle,
  LayoutDashboard,
  BarChart3,
  TrendingUp,
  CalendarDays,
  Briefcase,
  Inbox,
  Clock,
  FileSignature,
  Contact,
  Globe,
  Flame,
  Users,
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
import { getUnreadChatCount } from "./chat/actions";
import { getPendingRequestCount } from "./actions/getPendingRequestCount";

interface User {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
}

interface SidebarProps {
  user: User;
  isAdmin: boolean;
  signOutAction: () => Promise<void>;
  children: React.ReactNode;
}

type Badge = "chat" | "requests";
interface NavItem {
  href: string;
  label: string;
  Icon: LucideIcon;
  badge?: Badge;
  exclude?: string[];
}

const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [
      { href: "/admin/dashboard", label: "Dashboard", Icon: LayoutDashboard },
      { href: "/admin/analytics", label: "Analytics", Icon: BarChart3 },
      { href: "/admin/kpi", label: "KPIs", Icon: TrendingUp },
      { href: "/admin/calendar", label: "Calendar", Icon: CalendarDays },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/admin/contacts", label: "Contacts", Icon: IdCard },
      { href: "/admin/jobs", label: "Jobs", Icon: Briefcase },
      { href: "/admin/requests", label: "Requests", Icon: Inbox, badge: "requests" },
      { href: "/admin/waitlist", label: "Wait Lists", Icon: Clock },
      { href: "/admin/documents", label: "Documents", Icon: FileSignature },
      { href: "/admin/clients", label: "Clients", Icon: Contact },
      { href: "/admin/web-bookings", label: "Web Bookings", Icon: Globe },
      { href: "/admin/leads", label: "Leads", Icon: Flame },
      { href: "/admin/chat", label: "Chat", Icon: MessageCircle, badge: "chat" },
    ],
  },
  {
    label: "Staff",
    items: [
      { href: "/admin/employees", label: "Employees", Icon: Users },
      { href: "/admin/job-applications", label: "Job Applications", Icon: UserPlus },
      { href: "/admin/training-docs", label: "Training & Docs", Icon: GraduationCap },
      { href: "/admin/announcements", label: "Announcements", Icon: Megaphone },
    ],
  },
  {
    label: "Inventory & Supplies",
    items: [
      { href: "/admin/inventory", label: "Inventory", Icon: Package, exclude: ["/admin/inventory/rag-wash"] },
      { href: "/admin/inventory/rag-wash", label: "Rag Wash & Payouts", Icon: Droplets },
    ],
  },
  {
    label: "Sales & Marketing",
    items: [
      { href: "/admin/sales", label: "Sales Leads", Icon: MapPin },
      { href: "/admin/reports", label: "Lead Source & CPA", Icon: LineChart },
      { href: "/admin/quotes", label: "Quotes", Icon: FileText },
      { href: "/admin/gift-cards", label: "Gift Cards & Promos", Icon: Gift },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/admin/payouts", label: "Payouts", Icon: Wallet },
      { href: "/admin/finances", label: "Finances", Icon: Receipt },
      { href: "/admin/invoices", label: "Invoices", Icon: FileText },
      { href: "/admin/bulk-charge", label: "Bulk Charge", Icon: Banknote },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/admin/properties", label: "Property Engine", Icon: Database },
      { href: "/admin/logs", label: "Logs", Icon: ScrollText },
      { href: "/admin/settings", label: "Settings", Icon: Settings },
    ],
  },
];

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
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const [chatUnread, setChatUnread] = useState(0);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [chatToast, setChatToast] = useState<{ senderName: string; body: string } | null>(null);
  const prevLatestAtRef = useRef<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathnameRef = useRef(pathname);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = original; };
  }, [mobileOpen]);

  useEffect(() => {
    pathnameRef.current = pathname;
    if (pathname.startsWith("/admin/chat")) setChatToast(null);
  }, [pathname]);

  // Poll unread chat + toast on new messages
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      if (cancelled) return;
      try {
        const { count, latest } = await getUnreadChatCount();
        if (cancelled) return;
        setChatUnread(count);
        const latestAt = latest?.at ?? "";
        const isInitialized = prevLatestAtRef.current !== null;
        const hasNew = isInitialized && latestAt !== "" && latestAt !== prevLatestAtRef.current;
        if (hasNew && !pathnameRef.current.startsWith("/admin/chat")) {
          setChatToast({ senderName: latest!.senderName, body: latest!.body });
          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          toastTimerRef.current = setTimeout(() => setChatToast(null), 5000);
        }
        prevLatestAtRef.current = latestAt;
      } catch { /* ignore */ }
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Poll pending portal requests for the badge
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      if (cancelled) return;
      try {
        const { count } = await getPendingRequestCount();
        if (!cancelled) setPendingRequests(count);
      } catch { /* ignore */ }
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  function isActive(item: NavItem): boolean {
    if (item.exclude?.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
      return false;
    }
    return pathname === item.href || pathname.startsWith(item.href + "/");
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--cream)" }}>
      {/* Mobile hamburger */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
        aria-expanded={mobileOpen}
        className="md:hidden fixed top-4 left-4 z-30 p-2.5 rounded-xl bg-white/80 backdrop-blur-md shadow-md text-[#008C9C] hover:bg-white transition-colors print:hidden">
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
        } md:translate-x-0`}>
        {/* Logo */}
        <div className="asidebar-logo">
          <Link href="/admin/dashboard" className="flex items-center gap-2 min-w-0">
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
              className="ml-auto p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-[18px] pr-0.5">
          {NAV.map((section) => (
            <div className="asidebar-section" key={section.label}>
              <div className="asidebar-section-label">{section.label}</div>
              {section.items.map((item) => {
                const active = isActive(item);
                const badgeCount =
                  item.badge === "chat" ? chatUnread : item.badge === "requests" ? pendingRequests : 0;
                const Icon = item.Icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`anav-item ${active ? "active" : ""}`}>
                    <Icon size={16} strokeWidth={1.7} />
                    <span className="anav-label">{item.label}</span>
                    {badgeCount > 0 && (
                      <span className="anav-count alert">{badgeCount > 99 ? "99+" : badgeCount}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
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
            onClick={() => signOutAction()}>
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div
        className="md:ml-[240px] h-screen overflow-hidden overflow-y-auto print:!ml-0 print:!h-auto print:!overflow-visible"
        style={{ background: "var(--cream)" }}>
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
          }}>
          <style>{`
            @keyframes chat-toast-in {
              from { opacity: 0; transform: translateY(12px) scale(0.97); }
              to   { opacity: 1; transform: translateY(0)    scale(1); }
            }
          `}</style>
          <div style={{
            background: "#008C9C",
            borderRadius: 16,
            boxShadow: "0 8px 32px rgba(0,140,156,0.35), 0 2px 8px rgba(0,0,0,0.12)",
            padding: "14px 16px",
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: "rgba(255,255,255,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              <MessageCircle size={18} color="#fff" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "#fff", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {chatToast.senderName}
              </p>
              <p style={{
                fontSize: 12, color: "rgba(255,255,255,0.75)", margin: "3px 0 8px",
                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}>
                {chatToast.body}
              </p>
              <a
                href="/admin/chat"
                style={{ fontSize: 12, fontWeight: 600, color: "#fff", textDecoration: "none", opacity: 0.9 }}
                onClick={() => setChatToast(null)}>
                Open Chat →
              </a>
            </div>
            <button
              type="button"
              onClick={() => setChatToast(null)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                padding: 4, color: "rgba(255,255,255,0.6)", flexShrink: 0,
                display: "flex", alignItems: "center",
              }}>
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
