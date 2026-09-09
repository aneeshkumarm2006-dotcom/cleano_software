"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import type { AdminNotificationDTO } from "@/lib/admin-notifications";
import { markNotificationsRead } from "./actions";

const TONE: Record<string, { dot: string; cls: string }> = {
  ERROR: { dot: "bg-red-500", cls: "border-red-200 bg-red-50/40" },
  WARN: { dot: "bg-amber-500", cls: "border-amber-200 bg-amber-50/40" },
  INFO: { dot: "bg-[#008C9C]", cls: "border-gray-200 bg-white" },
};

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

export default function NotificationsClient({
  initial,
}: {
  initial: AdminNotificationDTO[];
}) {
  const [items, setItems] = useState(initial);
  const done = useRef(false);

  // Opening the page IS reading them. Marked once per mount rather than on
  // every render, and optimistically in local state so the badge and the dots
  // clear together instead of the page arguing with the sidebar.
  useEffect(() => {
    if (done.current) return;
    const unread = initial.filter((n) => !n.read).map((n) => n.id);
    if (unread.length === 0) return;
    done.current = true;
    markNotificationsRead(unread).then(() =>
      setItems((prev) => prev.map((n) => ({ ...n, read: true }))),
    );
  }, [initial]);

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center">
        <p className="text-sm text-gray-500">
          Nothing yet. Clock-ins, dropped shifts, photos and handoffs will appear here as
          they happen.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((n) => {
        const tone = TONE[n.severity] ?? TONE.INFO;
        const inner = (
          <div
            className={`flex gap-3 rounded-xl border p-4 transition ${tone.cls} ${
              n.href ? "hover:border-[#008C9C]/40" : ""
            }`}>
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-gray-900">{n.title}</span>
                <span className="text-xs text-gray-500 tabular-nums">{ago(n.createdAt)}</span>
              </div>
              {n.body ? <p className="mt-0.5 text-sm text-gray-600">{n.body}</p> : null}
            </div>
          </div>
        );
        return (
          <li key={n.id}>
            {n.href ? (
              <Link href={n.href} className="block">
                {inner}
              </Link>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ul>
  );
}
