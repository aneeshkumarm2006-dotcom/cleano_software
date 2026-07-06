"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Mail,
  Phone,
  MapPin,
  Sparkles,
  Home,
  CalendarClock,
  Clock,
  ArrowRight,
  X,
  Trash2,
  Tag,
  RotateCcw,
} from "lucide-react";
import { updateQuoteStatus } from "../actions/updateQuoteStatus";
import { bulkSetQuoteStatus } from "../actions/bulkSetQuoteStatus";
import { useRowSelection } from "@/components/common/useRowSelection";
import BulkActionBar, { BulkAction } from "@/components/common/BulkActionBar";
import { bulkSoftDelete, bulkRestore } from "@/lib/bulk/actions";

type Status = "NEW" | "CONTACTED" | "CONVERTED" | "ARCHIVED";

interface Quote {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  serviceType: string | null;
  bedCount: number | null;
  bathCount: number | null;
  squareFootage: number | null;
  preferredDate: string | null;
  message: string | null;
  status: Status;
  notes: string | null;
  createdAt: string;
}

interface Props {
  quotes: Quote[];
  archived?: boolean;
}

const ORDER: Status[] = ["NEW", "CONTACTED", "CONVERTED", "ARCHIVED"];

const STATUS: Record<Status, { label: string; dot: string; bg: string; fg: string }> = {
  NEW: { label: "New", dot: "#2f6fae", bg: "var(--blue-100)", fg: "var(--blue-800)" },
  CONTACTED: { label: "Contacted", dot: "#d97706", bg: "var(--amber-50)", fg: "var(--amber-800)" },
  CONVERTED: { label: "Converted", dot: "#059669", bg: "var(--emerald-100)", fg: "var(--emerald-800)" },
  ARCHIVED: { label: "Archived", dot: "#64748b", bg: "var(--slate-100)", fg: "var(--slate-700)" },
};

function StatusPill({ status }: { status: Status }) {
  const m = STATUS[status];
  return (
    <span className="pill" style={{ background: m.bg, color: m.fg }}>
      <span className="pill-dot" style={{ background: m.dot }} />
      {m.label}
    </span>
  );
}

function dateShort(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function timeShort(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function QuotesInboxClient({ quotes, archived = false }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Status | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [showStatus, setShowStatus] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: quotes.length };
    ORDER.forEach((s) => {
      c[s] = quotes.filter((q) => q.status === s).length;
    });
    return c;
  }, [quotes]);

  const tabs: { id: Status | "all"; label: string }[] = [
    { id: "all", label: "All" },
    ...ORDER.map((s) => ({ id: s, label: STATUS[s].label })),
  ];

  const visible = useMemo(
    () => (tab === "all" ? quotes : quotes.filter((q) => q.status === tab)),
    [quotes, tab]
  );
  const open = quotes.find((q) => q.id === openId) ?? null;

  // ── Multi-select + bulk actions ────────────────────────────────────────────
  const visibleIds = useMemo(() => visible.map((q) => q.id), [visible]);
  const sel = useRowSelection(visibleIds);

  async function runSetStatus(status: Status) {
    if (sel.count === 0) return;
    setBulkBusy(true);
    try {
      const res = await bulkSetQuoteStatus(sel.selectedIds, status);
      if (!res.success) {
        alert(res.error);
        return;
      }
      setShowStatus(false);
      sel.clear();
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  const bulkActions: BulkAction[] = archived
    ? [
        {
          key: "restore",
          label: "Restore",
          icon: <RotateCcw size={14} />,
          onRun: async () => {
            await bulkRestore("quote", sel.selectedIds);
            sel.clear();
            router.refresh();
          },
        },
      ]
    : [
        {
          key: "status",
          label: "Change status",
          icon: <Tag size={14} />,
          onRun: () => setShowStatus(true),
        },
        {
          key: "delete",
          label: "Delete",
          icon: <Trash2 size={14} />,
          variant: "danger",
          confirm: `Delete ${sel.count} selected quote${sel.count === 1 ? "" : "s"}? They can be restored from Archived.`,
          onRun: async () => {
            await bulkSoftDelete("quote", sel.selectedIds);
            sel.clear();
            router.refresh();
          },
        },
      ];

  return (
    <div className="admin-font stack-24" style={{ maxWidth: 1200, margin: "0 auto" }}>
      <header>
        <p className="eyebrow">Operations</p>
        <h1 className="display" style={{ fontSize: "clamp(32px, 4.2vw, 46px)", marginTop: 6 }}>
          Quote requests{" "}
          <span style={{ color: "var(--primary-40)", fontWeight: 300, fontFamily: "var(--font-serif)" }}>
            · {quotes.length}
          </span>
        </h1>
        <p className="subtitle" style={{ marginTop: 10, fontSize: 15.5 }}>
          Inbound estimate requests from the website. Review, quote, and convert to jobs.
        </p>
      </header>

      <div className="atabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`atab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}>
            {t.label}
            {counts[t.id] > 0 && <span className="atab-count">{counts[t.id]}</span>}
          </button>
        ))}
      </div>

      <div className="atable-wrap">
        <div className="atable-scroll">
          <table className="atable">
            <thead>
              <tr>
                <th className="col-select" style={{ width: 40, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={sel.allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = sel.someSelected;
                    }}
                    onChange={sel.toggleAll}
                    style={{ cursor: "pointer" }}
                  />
                </th>
                <th>Name</th>
                <th>Contact</th>
                <th>Service</th>
                <th>Received</th>
                <th>Status</th>
                <th className="col-actions" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 56, color: "var(--primary-50)" }}>
                    No {tab === "all" ? "" : STATUS[tab].label.toLowerCase() + " "}quote requests.
                  </td>
                </tr>
              ) : (
                visible.map((q) => (
                  <tr key={q.id} onClick={() => setOpenId(q.id)}>
                    <td
                      className="col-select"
                      style={{ textAlign: "center" }}
                      onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label="Select row"
                        checked={sel.isSelected(q.id)}
                        onChange={() => sel.toggle(q.id)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ cursor: "pointer" }}
                      />
                    </td>
                    <td className="col-client">
                      {q.name}
                      {q.address && <div className="col-client-sub">{q.address.split(",")[0]}</div>}
                    </td>
                    <td style={{ whiteSpace: "normal" }}>
                      <div style={{ fontSize: 13 }}>{q.email}</div>
                      {q.phone && (
                        <div style={{ fontSize: 12, color: "var(--primary-60)", marginTop: 2 }}>{q.phone}</div>
                      )}
                    </td>
                    <td style={{ whiteSpace: "normal", maxWidth: 200 }}>
                      <div style={{ fontWeight: 500 }}>{q.serviceType ?? "—"}</div>
                      {(q.bedCount != null || q.bathCount != null || q.squareFootage != null) && (
                        <div style={{ fontSize: 12, color: "var(--primary-60)", marginTop: 2 }}>
                          {[
                            q.bedCount != null ? `${q.bedCount}bd` : null,
                            q.bathCount != null ? `${q.bathCount}ba` : null,
                            q.squareFootage != null ? `${q.squareFootage} ft²` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      )}
                    </td>
                    <td className="col-date">
                      <div className="date-line">{dateShort(q.createdAt)}</div>
                      <div className="time-line">{timeShort(q.createdAt)}</div>
                    </td>
                    <td>
                      <StatusPill status={q.status} />
                    </td>
                    <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpenId(q.id)}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="apager">
          <span>
            {visible.length} {visible.length === 1 ? "request" : "requests"}
          </span>
          <span />
        </div>
      </div>

      {/* Bulk status picker (shown above the floating bar) */}
      {sel.count > 0 && showStatus && (
        <div
          style={{
            position: "sticky",
            bottom: 76,
            zIndex: 41,
            display: "flex",
            justifyContent: "center",
            marginTop: 12,
          }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              background: "#fff",
              border: "1px solid var(--primary-10)",
              borderRadius: 12,
              padding: "10px 14px",
              boxShadow: "0 8px 30px rgba(0,0,0,0.15)",
            }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
              Set status to
            </span>
            {ORDER.map((s) => (
              <button
                key={s}
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={bulkBusy}
                onClick={() => runSetStatus(s)}>
                {STATUS[s].label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowStatus(false)}
              style={{ background: "none", border: 0, cursor: "pointer", fontSize: 13, color: "var(--primary-60)" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <BulkActionBar
        count={sel.count}
        actions={bulkActions}
        onClear={() => {
          sel.clear();
          setShowStatus(false);
        }}
        noun="quote"
        total={visibleIds.length}
        allSelected={sel.allSelected}
        onToggleAll={sel.toggleAll}
      />

      {open && <QuoteDrawer key={open.id} quote={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function QuoteDrawer({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const router = useRouter();
  const [noteDraft, setNoteDraft] = useState(quote.notes ?? "");
  const [pending, startTransition] = useTransition();

  function persist(status: Status, notes: string, close: boolean) {
    startTransition(async () => {
      const res = await updateQuoteStatus({ quoteId: quote.id, status, notes });
      if (!res.success) {
        alert(res.error ?? "Failed to update");
        return;
      }
      if (close) onClose();
    });
  }

  return (
    <div className="qd-overlay" onClick={() => !pending && onClose()}>
      <div className="qd-panel" onClick={(e) => e.stopPropagation()}>
        <div className="qd-head">
          <div>
            <h3>{quote.name}</h3>
            <div className="qd-sub">
              Received {dateShort(quote.createdAt)} · {timeShort(quote.createdAt)}
            </div>
          </div>
          <button
            type="button"
            className="icon-btn"
            style={{ width: 30, height: 30 }}
            onClick={() => !pending && onClose()}
            aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="qd-body">
          <div className="q-drawer">
            <StatusPill status={quote.status} />

            <div className="q-rows">
              <div className="q-row">
                <span className="q-k">
                  <Mail size={15} /> Email
                </span>
                <a className="q-v link" href={`mailto:${quote.email}`}>
                  {quote.email}
                </a>
              </div>
              {quote.phone && (
                <div className="q-row">
                  <span className="q-k">
                    <Phone size={15} /> Phone
                  </span>
                  <a className="q-v link" href={`tel:${quote.phone}`}>
                    {quote.phone}
                  </a>
                </div>
              )}
              {quote.address && (
                <div className="q-row">
                  <span className="q-k">
                    <MapPin size={15} /> Address
                  </span>
                  <span className="q-v">{quote.address}</span>
                </div>
              )}
              {quote.serviceType && (
                <div className="q-row">
                  <span className="q-k">
                    <Sparkles size={15} /> Service
                  </span>
                  <span className="q-v">{quote.serviceType}</span>
                </div>
              )}
              {(quote.bedCount != null || quote.bathCount != null || quote.squareFootage != null) && (
                <div className="q-row">
                  <span className="q-k">
                    <Home size={15} /> Property
                  </span>
                  <span className="q-v">
                    {[
                      quote.bedCount != null ? `${quote.bedCount} bed` : null,
                      quote.bathCount != null ? `${quote.bathCount} bath` : null,
                      quote.squareFootage != null ? `${quote.squareFootage} ft²` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
              )}
              {quote.preferredDate && (
                <div className="q-row">
                  <span className="q-k">
                    <CalendarClock size={15} /> Preferred
                  </span>
                  <span className="q-v">
                    {new Date(quote.preferredDate).toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
              )}
              <div className="q-row">
                <span className="q-k">
                  <Clock size={15} /> Received
                </span>
                <span className="q-v">
                  {dateShort(quote.createdAt)} · {timeShort(quote.createdAt)}
                </span>
              </div>
            </div>

            {quote.message && (
              <div className="q-message">
                <div className="q-message-label">Customer message</div>
                <p>{quote.message}</p>
              </div>
            )}

            <div className="q-section-label">Status</div>
            <div className="q-status-grid">
              {ORDER.map((s) => {
                const m = STATUS[s];
                const on = quote.status === s;
                return (
                  <button
                    key={s}
                    type="button"
                    className={`q-status-btn ${on ? "on" : ""}`}
                    disabled={pending}
                    onClick={() => persist(s, noteDraft, false)}
                    style={on ? { background: m.bg, color: m.fg, borderColor: m.dot } : undefined}>
                    <span style={{ width: 7, height: 7, borderRadius: 99, background: m.dot }} />
                    {m.label}
                  </button>
                );
              })}
            </div>

            <div className="q-section-label">Internal notes</div>
            <textarea
              className="textarea"
              rows={4}
              placeholder="Quote amount, follow-up details…"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
            />

            <button
              type="button"
              className="btn btn-secondary btn-block"
              style={{ marginTop: 12 }}
              onClick={() => router.push("/admin/jobs/new")}>
              <ArrowRight size={15} /> Convert to job
            </button>
          </div>
        </div>

        <div className="qd-foot">
          <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={pending}
            onClick={() => persist(quote.status, noteDraft, true)}>
            {pending ? "Saving…" : "Save notes"}
          </button>
        </div>
      </div>
    </div>
  );
}
