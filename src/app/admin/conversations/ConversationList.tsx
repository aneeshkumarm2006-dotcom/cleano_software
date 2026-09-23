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
}

type View = "needs" | "ai" | "all";

const fmt = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" });

export default function ConversationList({ rows }: { rows: ThreadRow[] }) {
  // The open thread, read from the route rather than held in state, so a deep
  // link and a click land in exactly the same place.
  const activeId = useSelectedLayoutSegment();
  const [view, setView] = useState<View>("needs");
  const [q, setQ] = useState("");

  const counts = useMemo(
    () => ({
      needs: rows.filter((r) => r.needsHuman).length,
      ai: rows.filter((r) => !r.needsHuman && r.aiEnabled).length,
      all: rows.length,
    }),
    [rows],
  );

  // Start on whichever view has something in it. Opening the inbox on an empty
  // "Needs a person" tab hides every conversation behind a click.
  const effectiveView: View = counts.needs === 0 && view === "needs" ? "all" : view;

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows
      .filter((r) =>
        effectiveView === "needs"
          ? r.needsHuman
          : effectiveView === "ai"
            ? !r.needsHuman && r.aiEnabled
            : true,
      )
      .filter(
        (r) =>
          !term ||
          r.who.toLowerCase().includes(term) ||
          (r.subject ?? "").toLowerCase().includes(term) ||
          (r.preview ?? "").toLowerCase().includes(term),
      );
  }, [rows, effectiveView, q]);

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
          ["needs", "Needs a person", counts.needs],
          ["ai", "AI handling", counts.ai],
          ["all", "All", counts.all],
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
              : effectiveView === "needs"
                ? "Nobody is waiting on a person."
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
                  {r.needsHuman && <span className="cv-tag need">Needs a person</span>}
                  {!r.aiEnabled && <span className="cv-tag muted">AI muted</span>}
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
