"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle, Sparkles, CheckCircle2, X, Search, Clock, ArrowUpDown,
  ExternalLink, ChevronRight, ChevronLeft, RotateCcw, Ban, ShieldCheck,
} from "lucide-react";
import type { DuplicatePair, RejectedPair, ContactListItem } from "@/lib/crm-meta";
import {
  MATCH_LABELS, MERGE_FIELDS, contactFieldRaw, contactFieldDisplay,
  dateStr, relativeTime,
} from "@/lib/crm-meta";
import { formatDateTime } from "@/lib/timezone";
import { similarityBand, scoreDuplicatePair } from "@/lib/similarity";
import { Avatar, Pager } from "../_components";
import { useRowSelection } from "@/components/common/useRowSelection";
import BulkActionBar, { type BulkAction } from "@/components/common/BulkActionBar";
import {
  mergeContacts, rejectDuplicatePair, rejectDuplicatePairs, restoreDuplicatePair,
} from "../../actions/contactActions";

type Tab = "queue" | "rejected";
type SimFilter = "all" | "high" | "med" | "low";

const SIM_FILTERS: { id: SimFilter; label: string }[] = [
  { id: "all", label: "Any similarity" },
  { id: "high", label: "High · 85%+" },
  { id: "med", label: "Medium · 65–84%" },
  { id: "low", label: "Low · under 65%" },
];

export default function DuplicatesView({
  pairs,
  rejected,
  checkedAt,
}: {
  pairs: DuplicatePair[];
  rejected: RejectedPair[];
  checkedAt: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focus = searchParams.get("focus");

  // Optimistic overlays over the server payload. Keyed by content-derived ids
  // (`DP-<smaller>-<larger>`, the same scheme on both sides of the payload), so
  // a server refresh that already reflects the change can't resurrect a row and
  // re-syncing is a no-op.
  //
  // `router.refresh()` alone was not enough: this page is `force-dynamic` and
  // `listDuplicatePairs` rescans every contact, so on a slow link the repaint
  // is tens of seconds away — and rejecting only ever removed the row from the
  // QUEUE. Nothing put it on the Rejected tab, so the undo was unreachable
  // until the admin happened to reload. Both directions are now applied
  // locally first and reconciled when the refresh lands.
  const [resolvedPairIds, setResolvedPairIds] = useState<Set<string>>(new Set());
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());
  const [restoredIds, setRestoredIds] = useState<Set<string>>(new Set());
  /** Rejected this session — shown on the Rejected tab before the server agrees. */
  const [rejectedLocal, setRejectedLocal] = useState<RejectedPair[]>([]);
  /** Restored this session — put back in the queue before the server agrees. */
  const [restoredPairs, setRestoredPairs] = useState<DuplicatePair[]>([]);
  const [resolvedCount, setResolvedCount] = useState(0);

  const [tab, setTab] = useState<Tab>("queue");
  const [search, setSearch] = useState("");
  const [simFilter, setSimFilter] = useState<SimFilter>("all");
  const [sortDesc, setSortDesc] = useState(true);
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const live = useMemo(() => {
    // Pairs restored this session that the server payload hasn't caught up with
    // yet go back on the front of the queue, so Restore has a visible effect on
    // both tabs at once.
    const known = new Set(pairs.map((p) => p.id));
    const merged = [...pairs, ...restoredPairs.filter((p) => !known.has(p.id))];
    return merged.filter(
      (p) => !resolvedPairIds.has(p.id) && !archivedIds.has(p.a.id) && !archivedIds.has(p.b.id)
    );
  }, [pairs, restoredPairs, resolvedPairIds, archivedIds]);

  const queue = useMemo(() => {
    let list = live;
    const q = search.trim().toLowerCase();
    if (q) {
      const hit = (c: ContactListItem) =>
        c.name.toLowerCase().includes(q) ||
        (c.email || "").toLowerCase().includes(q) ||
        (c.phone || "").toLowerCase().includes(q);
      list = list.filter((p) => hit(p.a) || hit(p.b));
    }
    if (simFilter !== "all") list = list.filter((p) => similarityBand(p.score) === simFilter);
    return [...list].sort((x, y) =>
      sortDesc ? y.score - x.score || x.a.name.localeCompare(y.a.name)
               : x.score - y.score || x.a.name.localeCompare(y.a.name)
    );
  }, [live, search, simFilter, sortDesc]);

  const rejectedLive = useMemo(() => {
    const known = new Set(rejected.map((r) => r.id));
    // Locally rejected rows first (newest rejection at the top, matching the
    // server's `rejectedAt desc` ordering), then whatever the server knows.
    return [...rejectedLocal.filter((r) => !known.has(r.id)), ...rejected].filter(
      (r) => !restoredIds.has(r.id)
    );
  }, [rejected, rejectedLocal, restoredIds]);

  // ── Review queue ──
  const [activeId, setActiveId] = useState<string | null>(() => {
    if (!focus) return null;
    return pairs.find((p) => p.a.id === focus || p.b.id === focus)?.id ?? null;
  });
  const activeIndex = activeId ? queue.findIndex((p) => p.id === activeId) : -1;
  const activePair = activeIndex >= 0 ? queue[activeIndex] : null;

  /** Move to the first pair after the current one that survives `gone`. */
  function advance(gone: (p: DuplicatePair) => boolean) {
    const next = queue.find((p, i) => i > activeIndex && !gone(p));
    setActiveId(next?.id ?? null);
  }

  async function doMerge(pair: DuplicatePair, keepId: string, choices: Record<string, string>) {
    const dropId = keepId === pair.a.id ? pair.b.id : pair.a.id;
    setBusy(true);
    setError(null);
    const res = await mergeContacts(keepId, [pair.a.id, pair.b.id], choices);
    setBusy(false);
    if ("error" in res) { setError(res.error); return; }
    // Every other pair involving the archived record is stale too.
    advance((p) => p.id === pair.id || p.a.id === dropId || p.b.id === dropId);
    setArchivedIds((prev) => new Set(prev).add(dropId));
    setResolvedCount((n) => n + 1);
    router.refresh();
  }

  /** The Rejected-tab row a just-rejected queue pair becomes. */
  function asRejectedRow(pair: DuplicatePair): RejectedPair {
    return {
      id: pair.id,
      a: pair.a,
      b: pair.b,
      rejectedAt: new Date().toISOString(),
      rejectedBy: null,
    };
  }

  /** Apply a rejection locally: out of the queue, onto the Rejected tab. */
  function applyRejected(rejectedPairs: DuplicatePair[]) {
    const ids = new Set(rejectedPairs.map((p) => p.id));
    setResolvedPairIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
    setRestoredIds((prev) => {
      if (![...ids].some((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    setRestoredPairs((prev) => prev.filter((p) => !ids.has(p.id)));
    setRejectedLocal((prev) => [
      ...rejectedPairs.map(asRejectedRow),
      ...prev.filter((r) => !ids.has(r.id)),
    ]);
  }

  async function doReject(pair: DuplicatePair) {
    setBusy(true);
    setError(null);
    const res = await rejectDuplicatePair(pair.a.id, pair.b.id);
    setBusy(false);
    if ("error" in res) { setError(res.error); return; }
    advance((p) => p.id === pair.id);
    applyRejected([pair]);
    setResolvedCount((n) => n + 1);
    router.refresh();
  }

  async function doRestore(r: RejectedPair) {
    setBusy(true);
    setError(null);
    const res = await restoreDuplicatePair(r.a.id, r.b.id);
    setBusy(false);
    if ("error" in res) { setError(res.error); return; }
    // Off the Rejected tab…
    setRestoredIds((prev) => new Set(prev).add(r.id));
    setRejectedLocal((prev) => prev.filter((x) => x.id !== r.id));
    // …and back into the review queue. The server payload won't carry the pair
    // again until the rescan lands (this page is force-dynamic and re-derives
    // every pair), so the row is rebuilt here with the same pure scoring the
    // server ran — the reinstated row is identical to the one the refresh will
    // eventually bring, which is what makes the reconciliation a no-op.
    setResolvedPairIds((prev) => {
      if (!prev.has(r.id)) return prev;
      const next = new Set(prev);
      next.delete(r.id);
      return next;
    });
    const { score, matched } = scoreDuplicatePair(r.a, r.b);
    setRestoredPairs((prev) => [
      ...prev.filter((p) => p.id !== r.id),
      { id: r.id, a: r.a, b: r.b, score, matched },
    ]);
    router.refresh();
  }

  // ── Table paging + multi-select ──
  const total = queue.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(page, pageCount);
  const paged = queue.slice((safePage - 1) * perPage, safePage * perPage);
  const visibleIds = useMemo(() => paged.map((p) => p.id), [paged]);
  const selection = useRowSelection(visibleIds);

  const bulkActions: BulkAction[] = [
    {
      key: "reject",
      label: "Not duplicates",
      icon: <Ban size={14} />,
      confirm: `Reject ${selection.count} pair${selection.count === 1 ? "" : "s"}? They move to the Rejected tab and can be restored.`,
      onRun: async () => {
        const chosen = queue.filter((p) => selection.selectedIds.includes(p.id));
        const res = await rejectDuplicatePairs(chosen.map((p) => ({ aId: p.a.id, bId: p.b.id })));
        if ("error" in res) { setError(res.error); return; }
        applyRejected(chosen);
        setResolvedCount((n) => n + chosen.length);
        selection.clear();
        router.refresh();
      },
    },
  ];

  const recordsInvolved = new Set(live.flatMap((p) => [p.a.id, p.b.id])).size;
  const highConfidence = live.filter((p) => similarityBand(p.score) === "high").length;

  return (
    <div className="admin-font">
      <header className="row-between" style={{ marginBottom: 28, alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div className="stack-8" style={{ minWidth: 0 }}>
          <p className="eyebrow">CRM · Data hygiene</p>
          <h1 className="display" style={{ fontSize: "clamp(34px, 4.2vw, 48px)" }}>
            Manage duplicates <span style={{ color: "var(--primary-40)", fontWeight: 300 }}>· {live.length}</span>
          </h1>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => router.push("/admin/contacts")}>
            <ChevronLeft size={15} /> Back to contacts
          </button>
          {queue.length ? (
            <button className="btn btn-primary" onClick={() => setActiveId(queue[0].id)}>
              <Sparkles size={15} /> Start reviewing
            </button>
          ) : null}
        </div>
      </header>

      <div className="astat-grid" style={{ marginBottom: 24, gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
        <Stat icon={AlertCircle} label="Duplicate pairs" value={live.length} hint="awaiting review" />
        <Stat icon={Sparkles} label="Records involved" value={recordsInvolved} hint="across all pairs" />
        <Stat icon={ShieldCheck} label="High confidence" value={highConfidence} hint="85% similarity or more" />
      </div>

      <div className="cviews" style={{ marginBottom: 16 }}>
        <button className={`cview-chip ${tab === "queue" ? "active" : ""}`} onClick={() => setTab("queue")}>
          Review queue<span className="cview-count">{live.length}</span>
        </button>
        <button className={`cview-chip ${tab === "rejected" ? "active" : ""}`} onClick={() => setTab("rejected")}>
          Rejected<span className="cview-count">{rejectedLive.length}</span>
        </button>
      </div>

      {error ? (
        <div className="dup-error" role="alert">
          <AlertCircle size={15} /> {error}
          <button className="dup-error-x" aria-label="Dismiss" onClick={() => setError(null)}><X size={14} /></button>
        </div>
      ) : null}

      {tab === "queue" ? (
        <>
          <div className="atoolbar" style={{ marginBottom: 12 }}>
            <div className="atoolbar-search">
              <span className="atoolbar-search-icon"><Search size={16} /></span>
              <input
                className="input"
                type="search"
                placeholder="Search name, email, phone…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <select
              className="aselect"
              value={simFilter}
              onChange={(e) => { setSimFilter(e.target.value as SimFilter); setPage(1); }}
              aria-label="Filter by similarity"
            >
              {SIM_FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            <div style={{ flex: 1 }} />
            <select className="aselect" value={perPage} onChange={(e) => { setPerPage(parseInt(e.target.value, 10)); setPage(1); }}>
              <option value={10}>10 pairs</option>
              <option value={25}>25 pairs</option>
              <option value={50}>50 pairs</option>
            </select>
          </div>

          <p className="dup-checked">
            <Clock size={13} /> Last duplicate check: {formatDateTime(checkedAt, { year: "numeric" })}
            <span className="dup-checked-note"> · recomputed every time this page loads</span>
          </p>

          {total === 0 ? (
            <EmptyState
              title={live.length ? "No pairs match these filters" : "All clear"}
              body={
                live.length
                  ? "Clear the search or similarity filter to see the rest of the queue."
                  : "No duplicate pairs left to review. New matches surface here automatically."
              }
            />
          ) : (
            <div className="atable-wrap">
              <div className="atable-scroll">
                <table className="atable dup-table">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>
                        <input
                          type="checkbox"
                          aria-label="Select all pairs"
                          checked={selection.allSelected}
                          ref={(el) => { if (el) el.indeterminate = selection.someSelected; }}
                          onChange={selection.toggleAll}
                          style={{ cursor: "pointer", width: 16, height: 16 }}
                        />
                      </th>
                      <th>Contact</th>
                      <th>Email</th>
                      <th>Phone</th>
                      <th style={{ textAlign: "center" }}>
                        <button className="dup-sort" onClick={() => setSortDesc((v) => !v)}>
                          Similarity <ArrowUpDown size={12} />
                        </button>
                      </th>
                      <th className="col-actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map((p) => (
                      <PairRow
                        key={p.id}
                        pair={p}
                        selected={selection.isSelected(p.id)}
                        onToggle={() => selection.toggle(p.id)}
                        onReview={() => setActiveId(p.id)}
                        onReject={() => doReject(p)}
                        busy={busy}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={safePage} pageCount={pageCount} total={total} perPage={perPage} onChange={setPage} />
            </div>
          )}
        </>
      ) : (
        <RejectedTable rows={rejectedLive} onRestore={doRestore} busy={busy} />
      )}

      {activePair ? (
        <MergeReview
          key={activePair.id}
          pair={activePair}
          position={activeIndex + 1}
          total={queue.length}
          resolved={resolvedCount}
          busy={busy}
          onMerge={(keepId, choices) => doMerge(activePair, keepId, choices)}
          onReject={() => doReject(activePair)}
          onSkip={() => advance(() => false)}
          onClose={() => setActiveId(null)}
        />
      ) : null}

      {tab === "queue" ? (
        <BulkActionBar
          noun="pair"
          count={selection.count}
          actions={bulkActions}
          onClear={selection.clear}
          total={visibleIds.length}
          allSelected={selection.allSelected}
          onToggleAll={selection.toggleAll}
        />
      ) : null}
    </div>
  );
}

// ── Table pieces ─────────────────────────────────────────────────────────────

function Stat({ icon: Icon, label, value, hint }: { icon: typeof AlertCircle; label: string; value: number; hint: string }) {
  return (
    <div className="astat">
      <div className="astat-head"><span>{label}</span><span className="astat-icon"><Icon size={16} /></span></div>
      <div className="astat-value">{value}</div>
      <div className="astat-delta">{hint}</div>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="dcard" style={{ padding: 64, textAlign: "center" }}>
      <div style={{ width: 56, height: 56, margin: "0 auto 16px", borderRadius: 16, background: "var(--emerald-50)", color: "var(--emerald-600)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
        <CheckCircle2 size={28} />
      </div>
      <h3 className="title-sm" style={{ marginBottom: 6 }}>{title}</h3>
      <p className="subtitle" style={{ fontSize: 14, margin: 0 }}>{body}</p>
    </div>
  );
}

/** One record inside a stacked table cell. Fixed row height keeps the Contact,
    Email and Phone columns in lockstep so each band reads across. */
function RecordLine({ children }: { children: React.ReactNode }) {
  return <div className="dup-line">{children}</div>;
}

function PairRow({
  pair, selected, onToggle, onReview, onReject, busy,
}: {
  pair: DuplicatePair;
  selected: boolean;
  onToggle: () => void;
  onReview: () => void;
  onReject: () => void;
  busy: boolean;
}) {
  const band = similarityBand(pair.score);
  const records = [pair.a, pair.b];
  return (
    <tr className={selected ? "row-selected" : undefined} onClick={onReview}>
      <td onClick={(e) => e.stopPropagation()} style={{ width: 40 }}>
        <input
          type="checkbox"
          aria-label={`Select ${pair.a.name} / ${pair.b.name}`}
          checked={selected}
          onChange={onToggle}
          style={{ cursor: "pointer", width: 16, height: 16 }}
        />
      </td>
      <td style={{ minWidth: 240 }}>
        <div className="dup-stack">
          {records.map((c) => (
            <RecordLine key={c.id}>
              <div className="dup-rec">
                <Avatar name={c.name} color="var(--primary)" size={30} />
                <div style={{ minWidth: 0 }}>
                  <div className="dup-rec-name">{c.name}</div>
                  <div className="dup-rec-sub">created {dateStr(c.createdAt, { year: true })}</div>
                </div>
              </div>
            </RecordLine>
          ))}
        </div>
      </td>
      <td style={{ minWidth: 180 }}>
        <div className="dup-stack">
          {records.map((c) => (
            <RecordLine key={c.id}><span className="dup-val">{c.email || "—"}</span></RecordLine>
          ))}
        </div>
      </td>
      <td style={{ minWidth: 140 }}>
        <div className="dup-stack">
          {records.map((c) => (
            <RecordLine key={c.id}><span className="dup-val">{c.phone || "—"}</span></RecordLine>
          ))}
        </div>
      </td>
      <td style={{ minWidth: 140 }}>
        <div className="dup-sim">
          <span className={`match-score ${band}`}>{pair.score}%</span>
          <span className="dup-sim-bar"><span className={`dup-sim-fill ${band}`} style={{ width: `${pair.score}%` }} /></span>
          {pair.matched.length ? (
            <span className="dup-sim-matched">
              matched on {pair.matched.map((m) => MATCH_LABELS[m] || m).join(" · ").toLowerCase()}
            </span>
          ) : null}
        </div>
      </td>
      <td className="col-actions" onClick={(e) => e.stopPropagation()}>
        <div className="dup-actions">
          <button className="btn btn-primary btn-sm" onClick={onReview}>Review</button>
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={onReject}>Reject</button>
        </div>
      </td>
    </tr>
  );
}

function RejectedTable({
  rows, onRestore, busy,
}: {
  rows: RejectedPair[];
  onRestore: (r: RejectedPair) => void;
  busy: boolean;
}) {
  if (!rows.length) {
    return (
      <EmptyState
        title="Nothing rejected"
        body="Pairs you mark as “not duplicates” land here. Rejection only affects that one pair, and you can restore it at any time."
      />
    );
  }
  return (
    <div className="atable-wrap">
      <div className="atable-scroll">
        <table className="atable dup-table">
          <thead>
            <tr>
              <th>Contact</th>
              <th>Email</th>
              <th>Rejected</th>
              <th className="col-actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ cursor: "default" }}>
                <td style={{ minWidth: 240 }}>
                  <div className="dup-stack">
                    {[r.a, r.b].map((c) => (
                      <RecordLine key={c.id}>
                        <div className="dup-rec">
                          <Avatar name={c.name} color="var(--primary-light)" size={30} />
                          <div style={{ minWidth: 0 }}>
                            <div className="dup-rec-name">{c.name}</div>
                            <div className="dup-rec-sub">{c.phone || "—"}</div>
                          </div>
                        </div>
                      </RecordLine>
                    ))}
                  </div>
                </td>
                <td style={{ minWidth: 180 }}>
                  <div className="dup-stack">
                    {[r.a, r.b].map((c) => (
                      <RecordLine key={c.id}><span className="dup-val">{c.email || "—"}</span></RecordLine>
                    ))}
                  </div>
                </td>
                <td style={{ minWidth: 160, fontSize: 12.5, color: "var(--primary-70)" }}>
                  {relativeTime(r.rejectedAt)}
                  <div className="dup-rec-sub">by {r.rejectedBy || "Admin"}</div>
                </td>
                <td className="col-actions">
                  <div className="dup-actions">
                    <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onRestore(r)}>
                      <RotateCcw size={13} /> Restore
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Review modal ─────────────────────────────────────────────────────────────

/**
 * Per-property defaults: prefer the record that actually has a value; when both
 * do, prefer the one with more recent activity. Never default to a blank over
 * data — the previous "everything from the master" seeding silently archived
 * the only copy of a phone number whenever the master's was empty.
 */
function smartDefaults(pair: DuplicatePair): Record<string, string> {
  const aNewer = +new Date(pair.a.lastActivityAt) >= +new Date(pair.b.lastActivityAt);
  const fallback = aNewer ? pair.a.id : pair.b.id;
  const out: Record<string, string> = {};
  for (const f of MERGE_FIELDS) {
    if (!f.mergeable) continue;
    const av = contactFieldRaw(pair.a, f.k);
    const bv = contactFieldRaw(pair.b, f.k);
    out[f.k] = av && !bv ? pair.a.id : bv && !av ? pair.b.id : fallback;
  }
  return out;
}

function MergeReview({
  pair, position, total, resolved, busy, onMerge, onReject, onSkip, onClose,
}: {
  pair: DuplicatePair;
  position: number;
  total: number;
  resolved: number;
  busy: boolean;
  onMerge: (keepId: string, choices: Record<string, string>) => void;
  onReject: () => void;
  onSkip: () => void;
  onClose: () => void;
}) {
  const [choices, setChoices] = useState<Record<string, string>>(() => smartDefaults(pair));
  const [keepId, setKeepId] = useState(pair.a.id);
  const [explainerOpen, setExplainerOpen] = useState(false);

  const byId = useMemo(
    () => new Map([[pair.a.id, pair.a], [pair.b.id, pair.b]]),
    [pair]
  );
  const sides: [ContactListItem, ContactListItem] = [pair.a, pair.b];
  const mergeable = MERGE_FIELDS.filter((f) => f.mergeable);
  const readOnly = MERGE_FIELDS.filter((f) => !f.mergeable);
  const kept = byId.get(keepId)!;
  const dropped = keepId === pair.a.id ? pair.b : pair.a;

  const resultOf = (k: string) => contactFieldDisplay(byId.get(choices[k] ?? keepId) ?? kept, k);
  const isLast = position >= total;
  const done = resolved + (position - 1);
  const progress = total + resolved > 0 ? Math.round((done / (total + resolved)) * 100) : 0;

  return (
    <div className="crm-overlay" onClick={onClose}>
      <div className="crm-modal mrg-modal" onClick={(e) => e.stopPropagation()}>
        <div className="crm-modal-head">
          <div style={{ minWidth: 0 }}>
            <h2 className="crm-modal-title">Merge duplicate records</h2>
            <p className="crm-modal-sub">Customize your record merge — pick the value each property should keep.</p>
          </div>
          <div className="mrg-queue">
            <span className="mrg-queue-count">Pair {position} of {total}</span>
            <span className="mrg-queue-bar"><span className="mrg-queue-fill" style={{ width: `${progress}%` }} /></span>
          </div>
          <button className="dup-dismiss" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="crm-modal-body mrg-body">
          <div className="mrg-main">
            <div className="mrg-cards">
              {sides.map((c) => (
                <div key={c.id} className={`mrg-card ${keepId === c.id ? "keep" : ""}`}>
                  <div className="mrg-card-top">
                    <Avatar name={c.name} color={keepId === c.id ? "var(--primary)" : "var(--primary-light)"} size={38} />
                    <div style={{ minWidth: 0 }}>
                      <div className="mrg-card-name">{c.name}</div>
                      <div className="mrg-card-sub">{c.email || c.phone || "No contact details"}</div>
                    </div>
                  </div>
                  <div className="mrg-card-meta">Create date · {dateStr(c.createdAt, { year: true })}</div>
                  <div className="mrg-card-actions">
                    <a className="mrg-link" href={`/admin/contacts/${c.id}`} target="_blank" rel="noreferrer">
                      View record <ExternalLink size={12} />
                    </a>
                    {keepId === c.id ? (
                      <span className="mrg-kept"><CheckCircle2 size={12} /> Kept record</span>
                    ) : (
                      <button className="mrg-keepbtn" onClick={() => setKeepId(c.id)}>Keep this record instead</button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <h3 className="mrg-section">Customize properties</h3>
            <div className="mrg-props">
              {mergeable.map((f) => {
                const selected = choices[f.k] ?? keepId;
                const other = selected === pair.a.id ? pair.b.id : pair.a.id;
                const otherName = (byId.get(other) ?? pair.b).name;
                return (
                  <div className="mrg-prop" key={f.k}>
                    <div className="mrg-prop-label">{f.label}</div>
                    <div className="mrg-prop-row">
                      <PropOption
                        contact={pair.a}
                        field={f.k}
                        checked={selected === pair.a.id}
                        onPick={() => setChoices((p) => ({ ...p, [f.k]: pair.a.id }))}
                      />
                      <button
                        className={`mrg-push ${selected === pair.a.id ? "right" : "left"}`}
                        onClick={() => setChoices((p) => ({ ...p, [f.k]: other }))}
                        aria-label={`Use ${otherName}'s ${f.label.toLowerCase()}`}
                        title={`Use ${otherName}'s ${f.label.toLowerCase()}`}
                      >
                        {selected === pair.a.id ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
                      </button>
                      <PropOption
                        contact={pair.b}
                        field={f.k}
                        checked={selected === pair.b.id}
                        onPick={() => setChoices((p) => ({ ...p, [f.k]: pair.b.id }))}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <h3 className="mrg-section">For reference</h3>
            <div className="mrg-props">
              {readOnly.map((f) => (
                <div className="mrg-prop" key={f.k}>
                  <div className="mrg-prop-label">{f.label}</div>
                  <div className="mrg-prop-row">
                    <div className="mrg-opt static">{contactFieldDisplay(pair.a, f.k)}</div>
                    <span />
                    <div className="mrg-opt static">{contactFieldDisplay(pair.b, f.k)}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mrg-explainer">
              <button className="mrg-explainer-head" onClick={() => setExplainerOpen((v) => !v)} aria-expanded={explainerOpen}>
                <ChevronRight size={14} className={explainerOpen ? "open" : ""} />
                What happens when I merge contact records?
              </button>
              {explainerOpen ? (
                <div className="mrg-explainer-body">
                  <p><strong>{kept.name}</strong>&rsquo;s record is kept and takes the values selected above.</p>
                  <p><strong>{dropped.name}</strong>&rsquo;s record is archived, not deleted — it stays recoverable from the Archived contacts view, and every value it held is preserved there.</p>
                  <p>An audit entry listing the archived record and any changed value is written to the kept record&rsquo;s timeline.</p>
                </div>
              ) : null}
            </div>
          </div>

          <aside className="mrg-result">
            <div className="mrg-result-label">Resulting record</div>
            <div className="mrg-result-head">
              <Avatar name={resultOf("name")} color="var(--primary)" size={40} />
              <div style={{ minWidth: 0 }}>
                <div className="mrg-result-name">{resultOf("name")}</div>
                <div className="mrg-result-sub">{resultOf("email")}</div>
              </div>
            </div>
            <div className="mrg-result-meta">Create date · {dateStr(kept.createdAt, { year: true })}</div>
            <div className="mrg-result-props">
              {MERGE_FIELDS.map((f) => (
                <div className="mrg-result-row" key={f.k}>
                  <span className="mrg-result-k">{f.label}</span>
                  <span className="mrg-result-v">{f.mergeable ? resultOf(f.k) : contactFieldDisplay(kept, f.k)}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>

        <div className="crm-modal-foot mrg-foot">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
          <div style={{ flex: 1 }} />
          {!isLast ? (
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={onSkip}>Review next</button>
          ) : null}
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={onReject}>
            {isLast ? "Reject" : "Reject and review next"}
          </button>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onMerge(keepId, choices)}>
            {busy ? "Merging…" : isLast ? "Merge" : "Merge and review next"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PropOption({
  contact, field, checked, onPick,
}: {
  contact: ContactListItem;
  field: string;
  checked: boolean;
  onPick: () => void;
}) {
  const raw = contactFieldRaw(contact, field);
  return (
    <button
      type="button"
      className={`mrg-opt ${checked ? "chosen" : ""} ${raw ? "" : "blank"}`}
      onClick={onPick}
      aria-pressed={checked}
    >
      <span className="merge-radio" />
      <span className="mrg-opt-val">{contactFieldDisplay(contact, field)}</span>
    </button>
  );
}
