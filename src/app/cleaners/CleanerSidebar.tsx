"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { LogOut, Download, Share, MessageCircle, X } from "lucide-react";
import { useInstall } from "@/components/InstallContext";
import type { UnreadChatCount } from "@/lib/chatUnread";
import { useJobChatUnread } from "@/components/JobChatUnread";

/**
 * Gap between staff-chat unread polls, measured from the END of one to the
 * START of the next. 30s, up from a fixed 5s `setInterval` — see the effect
 * below.
 */
const CHAT_UNREAD_POLL_MS = 30_000;

interface Props {
  user: { name: string; email: string; role: string };
  signOutAction: () => Promise<void>;
}

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flexShrink: 0 }}>
      {children}
    </svg>
  );
}

const ICONS = {
  dashboard: (
    <Svg>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </Svg>
  ),
  jobs: (
    <Svg>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="14" x2="14" y2="14" />
      <line x1="8" y1="18" x2="12" y2="18" />
    </Svg>
  ),
  avail: (
    <Svg>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </Svg>
  ),
  calendar: (
    <Svg>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </Svg>
  ),
  availability: (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </Svg>
  ),
  pay: (
    <Svg>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </Svg>
  ),
  inventory: (
    <Svg>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </Svg>
  ),
  training: (
    <Svg>
      <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
      <path d="M6 12v5c3 3 9 3 12 0v-5" />
    </Svg>
  ),
  docs: (
    <Svg>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </Svg>
  ),
  chat: (
    <Svg>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </Svg>
  ),
  group: (
    <Svg>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Svg>
  ),
  announcements: (
    <Svg>
      <path d="m3 11 18-5v12L3 14v-3z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </Svg>
  ),
  settings: (
    <Svg>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Svg>
  ),
};

const NAV = [
  {
    label: "Workspace",
    items: [
      { href: "/cleaners/dashboard",      label: "Dashboard",      icon: ICONS.dashboard },
      { href: "/cleaners/my-jobs",        label: "My jobs",        icon: ICONS.jobs },
      { href: "/cleaners/available-jobs", label: "Available jobs", icon: ICONS.avail },
      { href: "/cleaners/calendar",       label: "Calendar",       icon: ICONS.calendar },
      { href: "/cleaners/availability",   label: "Availability",   icon: ICONS.availability },
    ],
  },
  {
    label: "Earnings",
    items: [
      { href: "/cleaners/my-pay",       label: "My pay",       icon: ICONS.pay },
      { href: "/cleaners/my-inventory", label: "My inventory", icon: ICONS.inventory },
    ],
  },
  {
    label: "Personal",
    items: [
      { href: "/cleaners/training",   label: "Training",  icon: ICONS.training },
      { href: "/cleaners/documents",  label: "Documents", icon: ICONS.docs },
      // Item 24: one Messages entry — direct + group chat are sub-tabs on the
      // chat pages themselves.
      { href: "/cleaners/chat",       label: "Messages",  icon: ICONS.chat },
      { href: "/cleaners/announcements", label: "Announcements", icon: ICONS.announcements },
    ],
  },
];

export default function CleanerSidebar({ user, signOutAction }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { canInstall, isStandalone, isIOSSafari, install } = useInstall();
  const showInstall = !isStandalone && (canInstall || isIOSSafari);

  // Manual refresh for the installed app (no browser reload button exists).
  const [refreshing, setRefreshing] = useState(false);
  function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    navigator.vibrate?.(8);
    router.refresh();
    // Keep the spin visible long enough to read as a deliberate action.
    setTimeout(() => setRefreshing(false), 900);
  }

  const [chatUnread, setChatUnread] = useState(0);
  // Job chat (client ↔ this cleaner) unread — separate from the staff chat
  // above, and shared with the badges on the My jobs list.
  const { total: jobChatUnread } = useJobChatUnread("cleaner");
  const [chatToast, setChatToast] = useState<{ senderName: string; body: string } | null>(null);
  const prevLatestAtRef = useRef<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathnameRef = useRef(pathname);
  const notificationPermissionRequestedRef = useRef(false);

  useEffect(() => {
    pathnameRef.current = pathname;
    if (pathname.startsWith("/cleaners/chat")) setChatToast(null);
  }, [pathname]);

  // Poll unread count + emit toast + browser notification on new messages.
  //
  // A PLAIN GET, not a server action, and self-paced rather than on a fixed
  // clock. `getUnreadChatCount` was a server action, and an action's response
  // carries an RSC re-render of whatever route the caller is standing on — so
  // this sidebar poll was restarting the render of every cleaner page every five
  // seconds, and `setInterval` kept firing whether or not the previous call had
  // returned. Same defect the admin sidebar had (round 5 K1); the full write-up
  // is in src/lib/chatUnread.ts.
  //
  // Deliberately NOT paused on a hidden tab, unlike the admin sidebar: the whole
  // point of the `Notification` branch below is to reach a cleaner whose tab is
  // backgrounded. Backing the interval off to 30s is what pays for that.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // One-time, gentle permission request after a short delay so it doesn't
    // collide with the install prompt.
    const askPermission = setTimeout(() => {
      if (
        !notificationPermissionRequestedRef.current &&
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "default"
      ) {
        notificationPermissionRequestedRef.current = true;
        Notification.requestPermission().catch(() => {});
      }
    }, 8000);

    async function poll() {
      if (cancelled) return;
      try {
        const res = await fetch("/api/chat/unread", {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`chat unread ${res.status}`);
        const { count, latest } = (await res.json()) as UnreadChatCount;
        if (cancelled) return;

        setChatUnread(count);

        const latestAt = latest?.at ?? "";
        const isInitialized = prevLatestAtRef.current !== null;
        const hasNew =
          isInitialized && latestAt !== "" && latestAt !== prevLatestAtRef.current;

        if (hasNew && latest && !pathnameRef.current.startsWith("/cleaners/chat")) {
          setChatToast({ senderName: latest.senderName, body: latest.body });
          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          toastTimerRef.current = setTimeout(() => setChatToast(null), 5000);

          // Native browser notification when granted and tab is backgrounded
          if (
            typeof window !== "undefined" &&
            "Notification" in window &&
            Notification.permission === "granted" &&
            document.visibilityState !== "visible"
          ) {
            try {
              const n = new Notification(`${latest.senderName} sent a message`, {
                body: latest.body,
                icon: "/icon/192",
                badge: "/icon/192",
                tag: "cleano-chat",
              });
              n.onclick = () => {
                window.focus();
                router.push("/cleaners/chat");
                n.close();
              };
            } catch {
              // ignore
            }
          }
        }

        prevLatestAtRef.current = latestAt;
      } catch {
        // ignore transient errors
      } finally {
        // Queue the next one only once this one is done, including on failure —
        // an erroring poll must still keep the badge alive, and a poll that
        // cannot outrun its own work can never build a queue.
        if (!cancelled) timer = setTimeout(poll, CHAT_UNREAD_POLL_MS);
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      clearTimeout(askPermission);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [router]);

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll while the drawer is open on mobile.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const words = (user.name || "").split(" ");
  const firstName = words[0] ?? "";
  const lastInitial = words[1]?.[0] ?? "";
  const displayName = lastInitial ? `${firstName} ${lastInitial}.` : firstName;

  const initials = ((firstName[0] ?? "") + (lastInitial ?? "")).toUpperCase();

  const isActive = (href: string) => {
    if (href === "/cleaners/dashboard") return pathname === "/cleaners/dashboard";
    // Item 24: group chat is a sub-tab of Messages — keep the entry lit.
    if (href === "/cleaners/chat" && pathname.startsWith("/cleaners/group-chat")) {
      return true;
    }
    return pathname.startsWith(href);
  };

  return (
    <>
      {/* Mobile top bar (hidden on desktop via CSS) */}
      <header className="cl-mobile-topbar">
        <button
          className="cl-mobile-burger"
          onClick={() => setOpen(true)}
          aria-label="Open menu">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span className="cl-mobile-title">cleano</span>
        <span className="cl-mobile-spacer" />
        {/* Installed apps have no browser reload button, so without this the
            only way to get fresh jobs was to kill the app. Pull-to-refresh
            covers the gesture; this covers everyone who doesn't find it. */}
        <button
          type="button"
          className={`cl-mobile-refresh${refreshing ? " spinning" : ""}`}
          onClick={handleRefresh}
          aria-label="Refresh">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <polyline points="21 3 21 9 15 9" />
          </svg>
        </button>
        <div className="cl-mobile-avatar">{initials}</div>
      </header>

      {/* Backdrop (mobile only) */}
      <div
        className={`cl-drawer-backdrop${open ? " cl-drawer-open" : ""}`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      <aside className={`cl-sidebar-dark${open ? " cl-drawer-open" : ""}`}>
        {/* Logo */}
        <div className="cl-snav-logo" style={{ marginBottom: 8 }}>
          <div className="cl-snav-mark">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <span className="cl-snav-wordmark">cleano</span>
          <span className="cl-snav-badge">Crew</span>
          <button
            className="cl-drawer-close"
            onClick={() => setOpen(false)}
            aria-label="Close menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        {/* Nav sections */}
        {NAV.map((section) => (
          <div key={section.label} className="cl-snav-section">
            <div className="cl-snav-section-label">{section.label}</div>
            {section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`cl-snav-item${isActive(item.href) ? " active" : ""}`}>
                {item.icon}
                <span>{item.label}</span>
                {item.href === "/cleaners/chat" && chatUnread > 0 && (
                  <span className="cl-snav-badge-count">
                    {chatUnread > 99 ? "99+" : chatUnread}
                  </span>
                )}
                {item.href === "/cleaners/my-jobs" && jobChatUnread > 0 && (
                  <span className="cl-snav-badge-count">
                    {jobChatUnread > 99 ? "99+" : jobChatUnread}
                  </span>
                )}
              </Link>
            ))}
          </div>
        ))}

        {/* Install app (only when installable and not already installed) */}
        {showInstall && (
          <div className="cl-snav-section">
            <button
              type="button"
              className="cl-snav-install"
              onClick={async () => {
                if (canInstall) {
                  await install();
                } else if (isIOSSafari) {
                  alert("To install Cleano:\n\n1. Tap the Share button in Safari\n2. Scroll down and tap 'Add to Home Screen'");
                }
                setOpen(false);
              }}>
              {isIOSSafari && !canInstall ? <Share size={16} /> : <Download size={16} />}
              <span>Install app</span>
              <span className="cl-snav-install-hint">
                {canInstall ? "1-tap" : "iOS"}
              </span>
            </button>
          </div>
        )}

        {/* User card */}
        <div style={{ marginTop: "auto", paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="cl-snav-user">
            <div className="cl-snav-avatar">{initials}</div>
            <div className="cl-snav-user-meta">
              <div className="cl-snav-user-name">{displayName}</div>
              <div className="cl-snav-user-role">Cleaner</div>
            </div>
            <button
              className="cl-snav-settings"
              onClick={() => router.push("/cleaners/settings")}
              aria-label="Settings">
              {ICONS.settings}
            </button>
            <form action={signOutAction}>
              <button
                type="submit"
                className="cl-snav-settings"
                aria-label="Sign out"
                title="Sign out">
                <LogOut size={14} />
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Chat notification toast */}
      {chatToast && (
        <div className="cl-chat-toast" role="status" aria-live="polite">
          <div className="cl-chat-toast-icon">
            <MessageCircle size={18} color="#fff" />
          </div>
          <div className="cl-chat-toast-body">
            <p className="cl-chat-toast-name">{chatToast.senderName}</p>
            <p className="cl-chat-toast-msg">{chatToast.body}</p>
            <button
              type="button"
              className="cl-chat-toast-link"
              onClick={() => {
                setChatToast(null);
                router.push("/cleaners/chat");
              }}>
              Open Chat →
            </button>
          </div>
          <button
            type="button"
            className="cl-chat-toast-close"
            onClick={() => setChatToast(null)}
            aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Bottom tab bar — visible only on mobile via CSS. */}
      <nav className="cl-tabbar" aria-label="Primary">
        {[
          { href: "/cleaners/dashboard",      label: "Home",      icon: ICONS.dashboard },
          { href: "/cleaners/my-jobs",        label: "Jobs",      icon: ICONS.jobs },
          { href: "/cleaners/available-jobs", label: "Available", icon: ICONS.avail },
          { href: "/cleaners/my-pay",         label: "Pay",       icon: ICONS.pay },
          { href: "/cleaners/chat",           label: "Chat",      icon: ICONS.chat },
        ].map((t) => (
          <Link
            key={t.href}
            href={t.href}
            onClick={() => setOpen(false)}
            className={`cl-tab${isActive(t.href) ? " active" : ""}`}>
            <span className="cl-tab-icon-wrap">
              {t.icon}
              {t.href === "/cleaners/chat" && chatUnread > 0 && (
                <span className="cl-tab-badge">
                  {chatUnread > 9 ? "9+" : chatUnread}
                </span>
              )}
              {t.href === "/cleaners/my-jobs" && jobChatUnread > 0 && (
                <span className="cl-tab-badge">
                  {jobChatUnread > 9 ? "9+" : jobChatUnread}
                </span>
              )}
            </span>
            <span>{t.label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
