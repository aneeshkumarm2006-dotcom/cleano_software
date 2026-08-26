"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The workspace table: search, filter, and keyboard movement.
 *
 * Everything it draws was already decided on the server — the status label, the
 * renewal wording, the money — and arrives as plain strings. The client's only
 * job is choosing which rows to show and which one is selected, so there is no
 * second copy of the "what state is this workspace in" rules to drift.
 *
 * There is deliberately no suspend button on a row. Locking a paying customer
 * out is one click from a mis-aimed cursor, so it lives on the workspace's own
 * page next to the sentence explaining what happens.
 */

export type Row = {
  id: string;
  slug: string;
  name: string;
  planLabel: string;
  /** "ok" | "trial" | "due" | "off" | "plain" */
  tone: string;
  stateLabel: string;
  /** For the filter chips. */
  bucket: "active" | "trialing" | "past_due" | "suspended" | "other";
  cleaners: number;
  seatLimit: number | null;
  jobs30d: number;
  money: string;
  renewText: string;
  renewTone: string;
  ownerName: string;
  ownerEmail: string;
  lastActive: string;
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "trialing", label: "Trialing" },
  { key: "past_due", label: "Payment failed" },
  { key: "suspended", label: "Suspended" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

function Seats({ used, limit }: { used: number; limit: number | null }) {
  if (limit == null) {
    return (
      <div className="seats">
        <span>{used} / ∞</span>
      </div>
    );
  }
  const pct = limit === 0 ? 100 : Math.round((used / limit) * 100);
  const tone = pct >= 100 ? "full" : pct >= 90 ? "near" : "";
  return (
    <div className={`seats ${tone}`}>
      <div className="meter">
        <i style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span>
        {used} / {limit}
      </span>
    </div>
  );
}

export default function WorkspaceTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const search = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.bucket] = (c[r.bucket] ?? 0) + 1;
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (filter === "all" || r.bucket === filter) &&
        (q === "" ||
          `${r.name} ${r.slug} ${r.ownerName} ${r.ownerEmail}`.toLowerCase().includes(q)),
    );
  }, [rows, filter, query]);

  // Keep the selection inside the visible list after a filter or search change.
  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(shown.length - 1, 0)));
  }, [shown.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      const typing = el instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);

      if (e.key === "/" && !typing) {
        e.preventDefault();
        search.current?.focus();
        return;
      }
      if (e.key === "Escape") {
        search.current?.blur();
        return;
      }
      if (typing || shown.length === 0) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, shown.length - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter") {
        const row = shown[sel];
        if (row) router.push(`/console/workspaces/${row.slug}`);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, sel, router]);

  return (
    <>
      <div className="filters" role="group" aria-label="Filter by state">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className="chip"
            aria-pressed={filter === f.key}
            onClick={() => {
              setFilter(f.key);
              setSel(0);
            }}
          >
            {f.label} <span className="n">{counts[f.key] ?? 0}</span>
          </button>
        ))}
        <span className="spacer" />
        <label className="sr" htmlFor="ws-search">
          Search workspaces
        </label>
        <input
          id="ws-search"
          ref={search}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          placeholder="Search name, address or owner"
          style={{ width: 260 }}
        />
        <span className="muted">
          {shown.length} {shown.length === 1 ? "workspace" : "workspaces"}
        </span>
      </div>

      <div className="tablewrap">
        <table className="wide">
          <thead>
            <tr>
              <th scope="col">Workspace</th>
              <th scope="col">Plan</th>
              <th scope="col">State</th>
              <th scope="col">Cleaners</th>
              <th scope="col" className="r">
                Jobs 30d
              </th>
              <th scope="col" className="r">
                Monthly
              </th>
              <th scope="col">Renews / ends</th>
              <th scope="col">Owner</th>
              <th scope="col">Last active</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty">
                  {query
                    ? `No workspace matches “${query}”. Try the company name, its address, or the owner.`
                    : "No workspaces in this state."}
                </td>
              </tr>
            ) : (
              shown.map((r, i) => (
                <tr
                  key={r.id}
                  className="click"
                  data-sel={i === sel ? 1 : 0}
                  tabIndex={0}
                  aria-label={`${r.name}, ${r.stateLabel}`}
                  onClick={() => router.push(`/console/workspaces/${r.slug}`)}
                  onFocus={() => setSel(i)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") router.push(`/console/workspaces/${r.slug}`);
                  }}
                >
                  <td>
                    <div className="org">
                      <b>{r.name}</b>
                      <span className="slug">{r.slug}.useawer.com</span>
                    </div>
                  </td>
                  <td>{r.planLabel}</td>
                  <td>
                    <span className={`pill ${r.tone}`}>{r.stateLabel}</span>
                  </td>
                  <td>
                    <Seats used={r.cleaners} limit={r.seatLimit} />
                  </td>
                  <td className={r.jobs30d ? "num r" : "num r muted"}>
                    {r.jobs30d.toLocaleString()}
                  </td>
                  <td className="num r">{r.money}</td>
                  <td className={`num ${r.renewTone}`}>{r.renewText}</td>
                  <td>
                    <div className="org">
                      <span>{r.ownerName}</span>
                      <span className="slug">{r.ownerEmail}</span>
                    </div>
                  </td>
                  <td className="num muted">{r.lastActive}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="hint">
        <span>
          <kbd>/</kbd> search
        </span>
        <span>
          <kbd>j</kbd> <kbd>k</kbd> move
        </span>
        <span>
          <kbd>Enter</kbd> open
        </span>
        <span className="muted">Suspending lives on the workspace page, not on the row.</span>
      </div>
    </>
  );
}
