"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, AlertCircle, MapPin, CheckCircle2, Archive, Trash2, RotateCcw, Tag } from "lucide-react";
import { markWaitlistNotified } from "../actions/markWaitlistNotified";
import { updateWaitlistStatus } from "../actions/updateWaitlistStatus";
import { useRowSelection } from "@/components/common/useRowSelection";
import BulkActionBar, { type BulkAction } from "@/components/common/BulkActionBar";
import { bulkSoftDelete, bulkRestore } from "@/lib/bulk/actions";
import { bulkSetWaitlistStatus } from "../actions/bulkSetWaitlistStatus";

type Status = "WAITING" | "NOTIFIED" | "CONVERTED" | "EXPIRED" | "CANCELLED";

interface Entry {
  id: string;
  preferredDate: string;
  email: string;
  name: string | null;
  phone: string | null;
  serviceType: string | null;
  bedCount: number | null;
  bathCount: number | null;
  notes: string | null;
  status: Status;
  notifiedAt: string | null;
  createdAt: string;
}

const SERVICE_LABELS: Record<string, string> = {
  standard: "Standard", deep: "Deep", "move-in": "Move-in",
  "move-out": "Move-out", office: "Office",
};

const STATUS_COLORS: Record<Status, { bg: string; fg: string; dot: string; label: string }> = {
  WAITING:   { bg: "rgba(217,119,6,0.12)",   fg: "#92400e", dot: "#d97706", label: "Waiting" },
  NOTIFIED:  { bg: "rgba(2,132,199,0.10)",   fg: "#075985", dot: "#0284c7", label: "Notified" },
  CONVERTED: { bg: "rgba(5,150,105,0.10)",   fg: "#065f46", dot: "#10b981", label: "Converted" },
  EXPIRED:   { bg: "rgba(148,163,184,0.18)", fg: "#475569", dot: "#94a3b8", label: "Expired" },
  CANCELLED: { bg: "rgba(148,163,184,0.18)", fg: "#475569", dot: "#94a3b8", label: "Cancelled" },
};

function StatusPill({ status }: { status: Status }) {
  const c = STATUS_COLORS[status];
  return (
    <span className="pill" style={{ background: c.bg, color: c.fg }}>
      <span className="pill-dot" style={{ background: c.dot }} />
      {c.label}
    </span>
  );
}

function AStatCard({ icon: Icon, label, value, hint, delta, deltaDir }: {
  icon: React.ElementType; label: string; value: number | string;
  hint?: string; delta?: string; deltaDir?: "up" | "down";
}) {
  return (
    <div className="astat">
      <div className="astat-head">
        <span>{label}</span>
        <span className="astat-icon"><Icon size={15} /></span>
      </div>
      <div className="astat-value">{value}</div>
      {(hint || delta) && (
        <div className={`astat-delta ${deltaDir ?? ""}`}>
          {delta && <strong>{delta}</strong>}
          {hint && <> {hint}</>}
        </div>
      )}
    </div>
  );
}

function daysAgo(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

function dateStr(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

// Preferred date is before the start of today (in the viewer's locale).
function isPastDate(iso: string) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return new Date(iso).getTime() < start.getTime();
}

const TABS = [
  { id: "all",       label: "All" },
  { id: "waiting",   label: "Waiting" },
  { id: "notified",  label: "Notified" },
  { id: "converted", label: "Converted" },
  { id: "expired",   label: "Expired" },
  { id: "cancelled", label: "Cancelled" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const STATUS_OPTIONS: Status[] = ["WAITING", "NOTIFIED", "CONVERTED", "EXPIRED", "CANCELLED"];

export default function WaitlistPageClient({ entries, archived }: { entries: Entry[]; archived: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stats = useMemo(() => ({
    total:     entries.length,
    // "Waiting"/"Notified" here mean *active* demand: open entries whose
    // preferred date has not yet passed. Past-dated entries are counted as
    // stale and excluded so they do not inflate active demand.
    waiting:   entries.filter(e => e.status === "WAITING"  && !isPastDate(e.preferredDate)).length,
    notified:  entries.filter(e => e.status === "NOTIFIED" && !isPastDate(e.preferredDate)).length,
    converted: entries.filter(e => e.status === "CONVERTED").length,
    expired:   entries.filter(e => e.status === "EXPIRED").length,
    cancelled: entries.filter(e => e.status === "CANCELLED").length,
    // Open entries whose preferred date is already in the past — need triage.
    stale:     entries.filter(e => (e.status === "WAITING" || e.status === "NOTIFIED") && isPastDate(e.preferredDate)).length,
  }), [entries]);

  // Tab badges reflect the number of rows actually listed under each tab
  // (raw status counts), independent of the active-demand stat cards above.
  const countFor = (id: TabId) =>
    id === "all" ? entries.length
      : entries.filter(e => e.status === id.toUpperCase()).length;

  const filtered = useMemo(() => {
    const list = tab === "all" ? entries
      : entries.filter(e => e.status === tab.toUpperCase());
    return [...list].sort((a, b) =>
      new Date(a.preferredDate).getTime() - new Date(b.preferredDate).getTime());
  }, [tab, entries]);

  const visibleIds = useMemo(() => filtered.map((w) => w.id), [filtered]);
  const selection = useRowSelection(visibleIds);

  const afterBulk = () => { selection.clear(); router.refresh(); };

  const bulkActions: BulkAction[] = archived
    ? [
        {
          key: "restore",
          label: "Restore",
          icon: <RotateCcw size={14} />,
          onRun: async () => { await bulkRestore("waitlist", selection.selectedIds); afterBulk(); },
        },
      ]
    : [
        {
          key: "status",
          label: "Change status",
          icon: <Tag size={14} />,
          onRun: async () => {
            const input = window.prompt(
              `Set status for ${selection.count} entr${selection.count === 1 ? "y" : "ies"}.\nType one of: ${STATUS_OPTIONS.join(", ")}`,
              "NOTIFIED"
            );
            if (!input) return;
            const next = input.trim().toUpperCase() as Status;
            if (!STATUS_OPTIONS.includes(next)) { setError(`Invalid status "${input}".`); return; }
            const res = await bulkSetWaitlistStatus(selection.selectedIds, next);
            if (!res.success) { setError(res.error); return; }
            afterBulk();
          },
        },
        {
          key: "delete",
          label: "Delete",
          icon: <Trash2 size={14} />,
          variant: "danger",
          confirm: `Delete ${selection.count} entr${selection.count === 1 ? "y" : "ies"}? Recoverable from Archived.`,
          onRun: async () => { await bulkSoftDelete("waitlist", selection.selectedIds); afterBulk(); },
        },
      ];

  async function handleNotify(id: string) {
    setBusyId(id); setError(null);
    const res = await markWaitlistNotified(id);
    setBusyId(null);
    if (!res.success) setError(res.error || "Failed to notify");
  }

  async function handleStatus(id: string, status: Status) {
    setBusyId(id); setError(null);
    await updateWaitlistStatus({ id, status });
    setBusyId(null);
  }

  return (
    <div className="admin-font stack-24">
      <header className="row-between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div className="stack-8">
          <p className="eyebrow">Sales</p>
          <h1 className="display">
            Waitlist{" "}
            <span style={{ color: "var(--primary-40)", fontWeight: 300 }}>· {stats.total}</span>
          </h1>
        </div>
        <a
          href={archived ? "/admin/waitlist" : "/admin/waitlist?archived=1"}
          className={`btn ${archived ? "btn-primary" : "btn-secondary"}`}>
          <Archive size={16} /> {archived ? "Active waitlist" : "Archived"}
        </a>
      </header>

      <div className="astat-grid">
        <AStatCard icon={Calendar}     label="Total entries" value={stats.total}     hint="all time" />
        <AStatCard icon={AlertCircle}  label="Waiting"       value={stats.waiting}   hint="not yet contacted" />
        <AStatCard icon={MapPin}       label="Notified"      value={stats.notified}  hint="awaiting response" />
        <AStatCard
          icon={CheckCircle2} label="Converted" value={stats.converted}
          delta={stats.total ? `${Math.round((stats.converted / stats.total) * 100)}%` : "0%"}
          deltaDir="up" hint="conversion rate"
        />
      </div>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "12px 16px", fontSize: 13, color: "#b91c1c" }}>
          {error}
        </div>
      )}

      <div className="atabs">
        {TABS.map(t => (
          <button key={t.id} type="button"
            className={`atab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}>
            {t.label}
            {countFor(t.id) > 0 && <span className="atab-count">{countFor(t.id)}</span>}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="atable-wrap" style={{ padding: "80px 40px", textAlign: "center", color: "var(--primary-60)" }}>
          No entries in this view.
        </div>
      ) : (
        <>
          <div className="atable-wrap" id="wl-desktop">
            <div className="atable-scroll">
              <table className="atable">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>
                      <input
                        type="checkbox"
                        aria-label="Select all entries"
                        checked={selection.allSelected}
                        ref={(el) => { if (el) el.indeterminate = selection.someSelected; }}
                        onChange={selection.toggleAll}
                        style={{ cursor: "pointer", width: 16, height: 16 }}
                      />
                    </th>
                    <th>Preferred date</th>
                    <th>Contact</th>
                    <th>Service</th>
                    <th>Status</th>
                    <th className="col-actions" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(w => {
                    const age = daysAgo(w.createdAt);
                    const past = isPastDate(w.preferredDate);
                    const openStatus = w.status === "WAITING" || w.status === "NOTIFIED";
                    return (
                      <tr key={w.id} className={selection.isSelected(w.id) ? "row-selected" : undefined}>
                        <td onClick={(e) => e.stopPropagation()} style={{ width: 40 }}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${w.name || w.email}`}
                            checked={selection.isSelected(w.id)}
                            onChange={() => selection.toggle(w.id)}
                            style={{ cursor: "pointer", width: 16, height: 16 }}
                          />
                        </td>
                        <td className="col-date" style={{ minWidth: 160 }}>
                          <div className="date-line">{dateStr(w.preferredDate)}</div>
                          <div className="time-line">Added {age === 0 ? "today" : `${age}d ago`}</div>
                          {past && openStatus && (
                            <span className="pill" style={{ marginTop: 4, background: "rgba(148,163,184,0.18)", color: "#475569" }}>
                              <span className="pill-dot" style={{ background: "#94a3b8" }} />
                              Date passed
                            </span>
                          )}
                        </td>
                        <td style={{ minWidth: 220 }}>
                          <div className="col-client">
                            {w.name || <em style={{ color: "var(--primary-50)" }}>No name</em>}
                          </div>
                          <div className="col-client-sub">{w.email}</div>
                          {w.phone && <div className="col-client-sub">{w.phone}</div>}
                        </td>
                        <td style={{ minWidth: 200, whiteSpace: "normal" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {w.serviceType && (
                              <span className="pill" style={{ background: "var(--primary-10)", color: "var(--primary)" }}>
                                {SERVICE_LABELS[w.serviceType] ?? w.serviceType}
                              </span>
                            )}
                            {(w.bedCount !== null || w.bathCount !== null) && (
                              <span style={{ fontSize: 12, color: "var(--primary-70)" }}>
                                {w.bedCount ?? "?"}bd · {w.bathCount ?? "?"}ba
                              </span>
                            )}
                          </div>
                          {w.notes && (
                            <div style={{ fontSize: 12, color: "var(--primary-60)", marginTop: 4, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {w.notes}
                            </div>
                          )}
                        </td>
                        <td><StatusPill status={w.status} /></td>
                        <td className="col-actions">
                          <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                            {w.status === "WAITING" && (
                              <button className="btn btn-primary btn-sm" disabled={busyId === w.id} onClick={() => handleNotify(w.id)}>Notify</button>
                            )}
                            {w.status === "NOTIFIED" && (
                              <button className="btn btn-primary btn-sm" disabled={busyId === w.id} onClick={() => handleStatus(w.id, "CONVERTED")}>Mark Converted</button>
                            )}
                            {past && openStatus && (
                              <button className="btn btn-secondary btn-sm" disabled={busyId === w.id} onClick={() => handleStatus(w.id, "EXPIRED")}>Mark expired</button>
                            )}
                            {w.status === "EXPIRED" && (
                              <button className="btn btn-secondary btn-sm" disabled={busyId === w.id} onClick={() => handleStatus(w.id, "WAITING")}><RotateCcw size={13} /> Reactivate</button>
                            )}
                            {openStatus && (
                              <button className="btn btn-danger-ghost btn-sm" disabled={busyId === w.id} onClick={() => handleStatus(w.id, "CANCELLED")}>Cancel</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div id="wl-mobile" style={{ display: "none", flexDirection: "column", gap: 10 }}>
            {filtered.map(w => {
              const age = daysAgo(w.createdAt);
              const past = isPastDate(w.preferredDate);
              const openStatus = w.status === "WAITING" || w.status === "NOTIFIED";
              return (
                <article key={w.id} className={`jcard${selection.isSelected(w.id) ? " row-selected" : ""}`}>
                  <div className="jcard-top">
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${w.name || w.email}`}
                        checked={selection.isSelected(w.id)}
                        onChange={() => selection.toggle(w.id)}
                        style={{ cursor: "pointer", width: 16, height: 16, marginTop: 3 }}
                      />
                      <div>
                        <div className="jcard-client">{w.name || w.email}</div>
                        <div className="jcard-meta">{w.email}</div>
                        {w.phone && <div className="jcard-meta">{w.phone}</div>}
                      </div>
                    </div>
                    <StatusPill status={w.status} />
                  </div>
                  <div className="jcard-row">
                    <div>
                      <div style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>{dateStr(w.preferredDate)}</div>
                      <div style={{ fontSize: 11, color: "var(--primary-60)" }}>Added {age === 0 ? "today" : `${age}d ago`}</div>
                      {past && openStatus && (
                        <div style={{ fontSize: 11, color: "#475569", fontWeight: 600, marginTop: 2 }}>Date passed</div>
                      )}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      {w.serviceType && <div style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>{SERVICE_LABELS[w.serviceType] ?? w.serviceType}</div>}
                      {(w.bedCount !== null || w.bathCount !== null) && (
                        <div style={{ fontSize: 11, color: "var(--primary-60)" }}>{w.bedCount ?? "?"}bd · {w.bathCount ?? "?"}ba</div>
                      )}
                    </div>
                  </div>
                  {(openStatus || w.status === "EXPIRED") && (
                    <div style={{ paddingTop: 10, borderTop: "1px solid var(--primary-10)", display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {w.status === "WAITING" && (
                        <button className="btn btn-primary btn-sm" disabled={busyId === w.id} onClick={() => handleNotify(w.id)}>Notify</button>
                      )}
                      {w.status === "NOTIFIED" && (
                        <button className="btn btn-primary btn-sm" disabled={busyId === w.id} onClick={() => handleStatus(w.id, "CONVERTED")}>Mark Converted</button>
                      )}
                      {past && openStatus && (
                        <button className="btn btn-secondary btn-sm" disabled={busyId === w.id} onClick={() => handleStatus(w.id, "EXPIRED")}>Mark expired</button>
                      )}
                      {w.status === "EXPIRED" && (
                        <button className="btn btn-secondary btn-sm" disabled={busyId === w.id} onClick={() => handleStatus(w.id, "WAITING")}><RotateCcw size={13} /> Reactivate</button>
                      )}
                      {openStatus && (
                        <button className="btn btn-danger-ghost btn-sm" disabled={busyId === w.id} onClick={() => handleStatus(w.id, "CANCELLED")}>Cancel</button>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <style>{`
            @media (max-width: 1000px) {
              #wl-desktop { display: none !important; }
              #wl-mobile  { display: flex !important; }
            }
            .atable tbody tr.row-selected { background: var(--primary-05, #f0fdff); }
            .jcard.row-selected { outline: 2px solid var(--primary-40, #008C9C); outline-offset: -1px; }
          `}</style>
        </>
      )}

      <BulkActionBar
        noun="entry"
        count={selection.count}
        actions={bulkActions}
        onClear={selection.clear}
        total={visibleIds.length}
        allSelected={selection.allSelected}
        onToggleAll={selection.toggleAll}
      />
    </div>
  );
}
