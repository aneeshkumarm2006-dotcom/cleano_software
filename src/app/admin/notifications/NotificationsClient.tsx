"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { AdminNotificationDTO } from "@/lib/admin-notifications";
import {
  dismissNotification,
  markAllNotificationsRead,
  markNotificationsRead,
  restoreNotification,
} from "./actions";

/**
 * The admin notification feed.
 *
 * Sept 10, item 13. This page used to mark EVERYTHING read the moment it
 * mounted, which is why nothing ever felt unread: by the time you had read the
 * first line, the app had decided you had read all fifty. Reading is now
 * something you do — open one, mark one, or mark all — and until you do, an
 * unread row looks unread.
 */

const TONE: Record<string, { dot: string; cls: string }> = {
  ERROR: { dot: "bg-red-500", cls: "border-red-200 bg-red-50/40" },
  WARN: { dot: "bg-amber-500", cls: "border-amber-200 bg-amber-50/40" },
  INFO: { dot: "bg-[#008C9C]", cls: "border-gray-200 bg-white" },
};

/**
 * Why this notification exists, in the admin's words rather than ours.
 *
 * Sept 10, item 12: "notification should show the reason". The key already
 * carries it — `admin.clock.clocked_out` is a clock event — so the label is
 * derived from the key rather than stored a second time and left to drift.
 */
const REASON: Record<string, string> = {
  "admin.clock": "Clock",
  "admin.checklist": "Checklist",
  "admin.job": "Job",
  "admin.shift": "Shift",
  "admin.unassigned": "Unassigned",
  "admin.billing": "Billing",
  "admin.ai": "Assistant",
  "admin.chat": "Messages",
  "admin.card": "Payment",
  "admin.invoice": "Invoice",
  "admin.cancel": "Cancellation",
  "admin.booking": "Booking",
};

function reasonOf(key: string): string {
  const prefix = key.split(".").slice(0, 2).join(".");
  return REASON[prefix] ?? "Activity";
}

function ago(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

type Tab = "unread" | "all";

export default function NotificationsClient({
  initial,
  archivedView = false,
}: {
  initial: AdminNotificationDTO[];
  /** True on `?view=archived`, where the rows are the ones normally hidden. */
  archivedView?: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [tab, setTab] = useState<Tab>("unread");
  const [pending, startTransition] = useTransition();

  const unreadCount = useMemo(() => items.filter((n) => !n.read).length, [items]);
  const shown = tab === "unread" ? items.filter((n) => !n.read) : items;

  /** Optimistic, so the row and the sidebar badge stop arguing with each other. */
  function markOne(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    startTransition(() => {
      void markNotificationsRead([id]);
    });
  }

  /**
   * Archiving is per-person and reversible (item 13). The row leaves this
   * list immediately; the server keeps it so the Archived view can show it.
   */
  function archive(id: string) {
    setItems((prev) => prev.filter((n) => n.id !== id));
    startTransition(() => {
      void dismissNotification(id);
    });
  }

  function restore(id: string) {
    setItems((prev) => prev.filter((n) => n.id !== id));
    startTransition(() => {
      void restoreNotification(id);
    });
  }

  function markAll() {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    startTransition(() => {
      void markAllNotificationsRead();
    });
  }

  /**
   * Opening one IS reading it, which is the PDF's own rule. The navigation
   * happens either way: a failed write must not strand the admin on this page.
   */
  function open(n: AdminNotificationDTO) {
    if (!n.read) markOne(n.id);
    if (n.href) router.push(n.href);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1">
          {(["unread", "all"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                tab === t
                  ? "bg-[#008C9C] text-white"
                  : "text-gray-600 hover:text-gray-900"
              }`}>
              {t === "unread" ? `Unread${unreadCount ? ` (${unreadCount})` : ""}` : "All"}
            </button>
          ))}
        </div>

        <a
          href={archivedView ? "/admin/notifications" : "/admin/notifications?view=archived"}
          className="rounded-xl px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900">
          {archivedView ? "Back to the feed" : "Archived"}
        </a>

        <button
          type="button"
          onClick={markAll}
          disabled={unreadCount === 0 || pending}
          className="rounded-xl border border-[#008C9C]/25 px-3 py-1.5 text-sm font-medium text-[#005a63] transition hover:border-[#008C9C]/50 disabled:cursor-not-allowed disabled:opacity-40">
          Mark all as read
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center">
          <p className="text-sm text-gray-500">
            {tab === "unread" && items.length > 0
              ? "Nothing unread. Switch to All to see the history."
              : "Nothing yet. Clock-ins, dropped shifts, photos and handoffs will appear here as they happen."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {shown.map((n) => {
            const tone = TONE[n.severity] ?? TONE.INFO;
            return (
              <li key={n.id}>
                <div
                  role={n.href ? "link" : undefined}
                  tabIndex={n.href ? 0 : undefined}
                  onClick={n.href ? () => open(n) : undefined}
                  onKeyDown={
                    n.href
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            open(n);
                          }
                        }
                      : undefined
                  }
                  className={`flex gap-3 rounded-xl border p-4 transition ${tone.cls} ${
                    n.href ? "cursor-pointer hover:border-[#008C9C]/40" : ""
                  } ${n.read ? "opacity-60" : ""}`}>
                  <span
                    aria-hidden
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      n.read ? "bg-gray-300" : tone.dot
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span
                        className={`${
                          n.read ? "font-medium text-gray-600" : "font-semibold text-gray-900"
                        }`}>
                        {n.title}
                      </span>
                      <span className="text-xs text-gray-500 tabular-nums">
                        {ago(n.createdAt)}
                      </span>
                    </div>
                    {n.body ? <p className="mt-0.5 text-sm text-gray-600">{n.body}</p> : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-600">
                        {reasonOf(n.key)}
                      </span>
                      {n.read ? (
                        <span className="text-[11px] text-gray-500">Read</span>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            markOne(n.id);
                          }}
                          className="text-[11px] font-medium text-[#005a63] underline-offset-2 hover:underline">
                          Mark as read
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (archivedView) restore(n.id);
                          else archive(n.id);
                        }}
                        className="text-[11px] font-medium text-gray-500 underline-offset-2 hover:underline">
                        {archivedView ? "Put back" : "Archive"}
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
