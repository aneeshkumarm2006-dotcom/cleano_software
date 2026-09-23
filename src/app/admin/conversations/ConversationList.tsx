"use client";

// The thread list, always on screen.
//
// The old page said, in prose, "Conversations that need a person are listed
// first". Sorting is not a control: there was no way to see ONLY those, and no
// count, so the sentence was something to take on trust. It is a filter now.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { Mail, MessageSquare, Search } from "lucide-react";

import NewMessageButton from "./NewMessageButton";

export interface ThreadRow {
  id: string;
  channel: string;
  who: string;
  isClient: boolean;
  subject: string | null;
  preview: string | null;
  lastMessageAt: string;
  needsHuman: boolean;
  aiEnabled: boolean;
  status: "OPEN" | "CLOSED";
  assignedToId: string | null;
  assignedToName: string | null;
}

/**
 * The five views people actually live in.
 *
 * Deliberately not HubSpot's eight. Spam, Trash and Sent are concepts a
 * cleaning office does not have, and every extra tab is another place a
 * conversation can hide.
 */
type View = "mine" | "unassigned" | "needs" | "open" | "closed";

const fmt = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" });

export default function ConversationList({
  rows,
  meId,
}: {
  rows: ThreadRow[];
  meId: string;
}) {
  // The open thread, read from the route rather than held in state, so a deep
  // link and a click land in exactly the same place.
  const activeId = useSelectedLayoutSegment();
  const [view, setView] = useState<View>("mine");
  const [q, setQ] = useState("");

  const open = useMemo(() => rows.filter((r) => r.status === "OPEN"), [rows]);
  const counts = useMemo(
    () => ({
      mine: open.filter((r) => r.assignedToId === meId).length,
      unassigned: open.filter((r) => !r.assignedToId).length,
      needs: open.filter((r) => r.needsHuman).length,
      open: open.length,
      closed: rows.length - open.length,
    }),
    [rows, open, meId],
  );

  // Land on the first view that has something in it. Opening the inbox on an
  // empty tab hides every conversation behind a click, and "Mine" is empty for
  // everyone until assignment is actually used.
  const effectiveView: View =
    counts[view] > 0
      ? view
      : counts.mine > 0
        ? "mine"
        : counts.unassigned > 0
          ? "unassigned"
          : counts.open > 0
            ? "open"
            : view;

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (effectiveView === "closed") return r.status === "CLOSED";
        if (r.status === "CLOSED") return false;
        if (effectiveView === "mine") return r.assignedToId === meId;
        if (effectiveView === "unassigned") return !r.assignedToId;
        if (effectiveView === "needs") return r.needsHuman;
        return true;
      })
      .filter(
        (r) =>
          !term ||
          r.who.toLowerCase().includes(term) ||
          (r.subject ?? "").toLowerCase().includes(term) ||
          (r.preview ?? "").toLowerCase().includes(term),
      );
  }, [rows, effectiveView, q, meId]);

  return (
    <aside className="cv-list" aria-label="Conversations">
      <div className="cv-list-head">
        <div className="cv-list-title">
          <h1>Inbox</h1>
          <NewMessageButton />
        </div>
        <div className="cv-search">
          <Search size={14} aria-hidden="true" />
          <input
            id="cv-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, address or message…"
            aria-label="Search conversations"
          />
        </div>
      </div>

      <div className="cv-views" role="tablist" aria-label="Filter conversations">
        {([
          ["mine", "Mine", counts.mine],
          ["unassigned", "Unassigned", counts.unassigned],
          ["needs", "Needs a person", counts.needs],
          ["open", "All open", counts.open],
          ["closed", "Closed", counts.closed],
        ] as const).map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={effectiveView === id}
            className={`cv-view ${effectiveView === id ? "on" : ""}`}
            onClick={() => setView(id)}>
            {label} <b>{n}</b>
          </button>
        ))}
      </div>

      <div className="cv-threads">
        {shown.length === 0 ? (
          <p className="cv-none">
            {q
              ? "Nothing matches that search."
              : effectiveView === "mine"
                ? "Nothing is assigned to you."
                : effectiveView === "unassigned"
                  ? "Everything open has an owner."
                  : effectiveView === "needs"
                    ? "Nobody is waiting on a person."
                    : effectiveView === "closed"
                      ? "Nothing has been closed yet."
                      : "No conversations yet. When the assistant is on (Settings → AI Assistant), texts and emails appear here."}
          </p>
        ) : (
          shown.map((r) => (
            <Link
              key={r.id}
              href={`/admin/conversations/${r.id}`}
              aria-current={activeId === r.id ? "page" : undefined}
              className={`cv-thr ${activeId === r.id ? "on" : ""} ${r.needsHuman ? "flag" : ""}`}>
              <span className={`cv-ch ${r.channel === "SMS" ? "sms" : "mail"}`} aria-hidden="true">
                {r.channel === "SMS" ? <MessageSquare size={14} /> : <Mail size={14} />}
              </span>
              <span className="cv-thr-main">
                <span className="cv-thr-top">
                  <span className="cv-thr-who">{r.who}</span>
                  <span className="cv-thr-when">{fmt.format(new Date(r.lastMessageAt))}</span>
                </span>
                {r.subject && <span className="cv-thr-sub">{r.subject}</span>}
                {r.preview && <span className="cv-thr-prev">{r.preview}</span>}
                <span className="cv-tags">
                  {r.status === "CLOSED" && <span className="cv-tag done">Closed</span>}
                  {r.status === "OPEN" && r.needsHuman && (
                    <span className="cv-tag need">Needs a person</span>
                  )}
                  {/* Who owns it, on the row — the whole point of assignment is
                      seeing it without opening the thread. */}
                  {r.assignedToName && (
                    <span className="cv-tag who">
                      {r.assignedToId === meId ? "You" : r.assignedToName}
                    </span>
                  )}
                  {r.status === "OPEN" && !r.assignedToId && (
                    <span className="cv-tag muted">Unassigned</span>
                  )}
                  {!r.isClient && <span className="cv-tag new">New contact</span>}
                </span>
              </span>
            </Link>
          ))
        )}
      </div>
    </aside>
  );
}
