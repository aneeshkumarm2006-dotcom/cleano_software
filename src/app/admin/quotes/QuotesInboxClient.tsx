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
  ExternalLink,
  SlidersHorizontal,
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
import { STORE_TZ } from "@/lib/timezone";
import { jobTypeLabel } from "@/lib/calendar-labels";
import type { QuotePageConfig } from "@/lib/quote-page-config";
import QuoteFormTab from "./QuoteFormTab";

type Status = "NEW" | "CONTACTED" | "CONVERTED" | "ARCHIVED";

/** The public quote page. Relative on purpose: it always resolves, custom
 *  domain or not — the domain only matters for the embed snippets. */
const PUBLIC_QUOTE_PATH = "/quote";

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
  /** OWNER/ADMIN only — the Form tab writes an audited setting. */
  canEditForm?: boolean;
  /** Service category key -> the admin's own service name. */
  serviceLabels?: Record<string, string>;
  quoteConfig?: QuotePageConfig;
  services?: { value: string; label: string }[];
  brandName?: string;
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
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: STORE_TZ });
}
function timeShort(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: STORE_TZ });
}

export default function QuotesInboxClient({
  quotes,
  archived = false,
  canEditForm = false,
  serviceLabels = {},
  quoteConfig,
  services = [],
  brandName = "",
}: Props) {
  const router = useRouter();
  // "form" is a VIEW, not a status filter — it swaps the table for the page
  // editor. Kept in the same strip because that is where the client looked for
  // it, and separated by a divider so it doesn't read as a sixth filter.
  const [tab, setTab] = useState<Status | "all" | "form">("all");
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
    () =>
      tab === "all" || tab === "form"
        ? quotes
        : quotes.filter((q) => q.status === tab),
    [quotes, tab]
  );
  const editingForm = tab === "form";

  /** Quotes store a category key now; older rows store the label they were
   *  submitted with. `jobTypeLabel` resolves both, and prefers the admin's own
   *  service name so renaming a service renames it here too. */
  const serviceName = (raw: string | null) =>
    raw ? jobTypeLabel(raw, serviceLabels) || raw : null;
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
    <div
      className="admin-font stack-24"
      style={{ maxWidth: editingForm ? 1500 : 1200, margin: "0 auto" }}>
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}>
        <div>
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
        </div>
        {/* 10.2 — "I'm not sure how to access it right now." `/quote` appeared
            in exactly one file in src/ outside its own folder, and nowhere in
            the admin UI at all. This is the link. */}
        <a
          className="btn btn-secondary"
          href={PUBLIC_QUOTE_PATH}
          target="_blank"
          rel="noopener noreferrer"
          style={{ marginTop: 6, whiteSpace: "nowrap" }}>
          View public page <ExternalLink size={14} />
        </a>
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
        {canEditForm && quoteConfig && (
          <>
            <span
              aria-hidden
              style={{
                width: 1,
                alignSelf: "stretch",
                margin: "4px 4px",
                background: "var(--primary-10)",
              }}
            />
            <button
              type="button"
              className={`atab ${editingForm ? "active" : ""}`}
              onClick={() => setTab("form")}>
              <SlidersHorizontal size={13} />
              Form
            </button>
          </>
        )}
      </div>

      {editingForm && quoteConfig ? (
        <QuoteFormTab
          initialConfig={quoteConfig}
          services={services}
          brandName={brandName}
          publicUrl={PUBLIC_QUOTE_PATH}
        />
      ) : (
        <>

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
                    No {tab === "all" || tab === "form" ? "" : STATUS[tab].label.toLowerCase() + " "}
                    quote requests.
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
                      <div style={{ fontWeight: 500 }}>{serviceName(q.serviceType) ?? "—"}</div>
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

      {open && (
        <QuoteDrawer
          key={open.id}
          quote={open}
          serviceName={serviceName(open.serviceType)}
          onClose={() => setOpenId(null)}
        />
      )}
        </>
      )}
    </div>
  );
}

function QuoteDrawer({
  quote,
  serviceName,
  onClose,
}: {
  quote: Quote;
  serviceName: string | null;
  onClose: () => void;
}) {
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
              {serviceName && (
                <div className="q-row">
                  <span className="q-k">
                    <Sparkles size={15} /> Service
                  </span>
                  <span className="q-v">{serviceName}</span>
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
                      timeZone: STORE_TZ,
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

            {/* TODO(client): phase 2 (10.5) — actually SEND a quote. The price
                still lives in this free-text note and no email carries it:
                `submitQuote` sends "we got it", and after that the customer
                hears nothing until someone writes by hand. A working priced-
                quote engine already exists, unused, at
                src/app/(book)/actions/getQuote.ts — the build is a `Send quote`
                action + an email template, not a pricing engine. Deliberately
                not built this stage; it is a customer-facing money email and
                wants its own review. */}
            <div className="q-section-label">Internal notes</div>
            <textarea
              className="textarea"
              rows={4}
              placeholder="Quote amount, follow-up details…"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
            />

            {/* 10.4 — this was a bare `router.push("/admin/jobs/new")` with no
                query string, so name, email, phone, address, service, beds,
                baths, sqft and preferred date were all discarded and the admin
                retyped a form they were already looking at. The id travels;
                the form prefills from it and flips the quote to CONVERTED when
                the job saves. */}
            <button
              type="button"
              className="btn btn-secondary btn-block"
              style={{ marginTop: 12 }}
              onClick={() =>
                router.push(`/admin/jobs/new?fromQuote=${encodeURIComponent(quote.id)}`)
              }>
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
