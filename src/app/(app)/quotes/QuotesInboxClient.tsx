"use client";

import { useMemo, useState, useTransition } from "react";
import { updateQuoteStatus } from "../actions/updateQuoteStatus";

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
}

const STATUS_OPTIONS: Status[] = ["NEW", "CONTACTED", "CONVERTED", "ARCHIVED"];

const STATUS_TINT: Record<Status, { bg: string; fg: string }> = {
  NEW: { bg: "#fef3c7", fg: "#854d0e" },
  CONTACTED: { bg: "#dbeafe", fg: "#1e40af" },
  CONVERTED: { bg: "#dcfce7", fg: "#166534" },
  ARCHIVED: { bg: "#f1f5f9", fg: "#475569" },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function QuotesInboxClient({ quotes }: Props) {
  const [filter, setFilter] = useState<Status | "ALL">("ALL");
  const [open, setOpen] = useState<Quote | null>(null);
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    if (filter === "ALL") return quotes;
    return quotes.filter((q) => q.status === filter);
  }, [quotes, filter]);

  function setStatus(quoteId: string, status: Status, notes?: string) {
    startTransition(async () => {
      const result = await updateQuoteStatus({ quoteId, status, notes });
      if (!result.success) alert(result.error ?? "Failed to update");
      else setOpen(null);
    });
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: quotes.length };
    STATUS_OPTIONS.forEach(s => { c[s] = quotes.filter(q => q.status === s).length; });
    return c;
  }, [quotes]);

  return (
    <div className="admin-font stack-24">
      <header className="stack-8">
        <p className="eyebrow">Operations</p>
        <h1 className="display">
          Quote Requests{" "}
          <span style={{ color: "var(--primary-40)", fontWeight: 300 }}>· {quotes.length}</span>
        </h1>
        <p style={{ fontSize: 14, color: "var(--primary-60)" }}>Submissions from the public quote page. Triage and convert.</p>
      </header>

      <div className="atabs">
        {(["ALL", ...STATUS_OPTIONS] as const).map(s => (
          <button key={s} type="button" className={`atab${filter === s ? " active" : ""}`} onClick={() => setFilter(s)}>
            {s} {counts[s] !== undefined && <span style={{ opacity: 0.6, fontSize: 11 }}>({counts[s]})</span>}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="atable-wrap" style={{ padding: "80px 40px", textAlign: "center", color: "var(--primary-60)" }}>
          No quote requests yet.
        </div>
      ) : (
        <div className="atable-wrap">
          <div className="atable-scroll">
            <table className="atable">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Service</th>
                  <th>Received</th>
                  <th>Status</th>
                  <th className="col-actions" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(q => (
                  <tr key={q.id} onClick={() => setOpen(q)}>
                    <td style={{ minWidth: 160 }}>
                      <div className="col-client">{q.name}</div>
                      {q.address && <div className="col-client-sub">{q.address}</div>}
                    </td>
                    <td style={{ minWidth: 180 }}>
                      <div className="col-client-sub">{q.email}</div>
                      {q.phone && <div className="col-client-sub">{q.phone}</div>}
                    </td>
                    <td>
                      <span style={{ fontSize: 12, color: "var(--primary-70)" }}>{q.serviceType ?? "—"}</span>
                      {(q.bedCount != null || q.bathCount != null) && (
                        <div className="col-client-sub">{[q.bedCount != null ? `${q.bedCount}bd` : null, q.bathCount != null ? `${q.bathCount}ba` : null].filter(Boolean).join(" · ")}</div>
                      )}
                    </td>
                    <td><span style={{ fontSize: 12, color: "var(--primary-70)" }}>{fmtDate(q.createdAt)}</span></td>
                    <td>
                      <span style={{ display: "inline-block", background: STATUS_TINT[q.status].bg, color: STATUS_TINT[q.status].fg, fontSize: 11, fontWeight: 600, borderRadius: 20, padding: "2px 10px" }}>
                        {q.status}
                      </span>
                    </td>
                    <td className="col-actions" onClick={e => e.stopPropagation()}>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(q)}>Open</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {open && (
        <QuoteDrawer
          quote={open}
          onClose={() => setOpen(null)}
          onStatus={(s, n) => setStatus(open.id, s, n)}
        />
      )}
    </div>
  );
}


function QuoteDrawer({
  quote,
  onClose,
  onStatus,
}: {
  quote: Quote;
  onClose: () => void;
  onStatus: (status: Status, notes?: string) => void;
}) {
  const [notes, setNotes] = useState(quote.notes ?? "");
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,60,70,0.55)", backdropFilter: "blur(2px)",
        zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 20, maxWidth: 560, width: "100%",
          padding: 28, boxShadow: "0 20px 60px rgba(0,60,70,0.25)",
          maxHeight: "85vh", overflowY: "auto",
        }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{quote.name}</h2>
        <p style={{ marginTop: 4, fontSize: 13, color: "var(--primary-70)" }}>
          {quote.email}
          {quote.phone ? ` · ${quote.phone}` : ""}
        </p>

        <div style={{ marginTop: 20, display: "grid", gap: 10 }}>
          <Field label="Service" value={quote.serviceType ?? "—"} />
          <Field label="Address" value={quote.address ?? "—"} />
          <Field
            label="Property"
            value={[
              quote.bedCount != null ? `${quote.bedCount} bed` : null,
              quote.bathCount != null ? `${quote.bathCount} bath` : null,
              quote.squareFootage ? `${quote.squareFootage} sq ft` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "—"}
          />
          <Field
            label="Preferred date"
            value={
              quote.preferredDate
                ? new Date(quote.preferredDate).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : "—"
            }
          />
          <Field label="Message" value={quote.message ?? "—"} />
        </div>

        <label
          style={{
            display: "block",
            marginTop: 16,
            fontSize: 12,
            fontWeight: 600,
            color: "var(--primary-70)",
          }}>
          Internal notes
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          style={{
            marginTop: 4,
            width: "100%",
            padding: "8px 12px",
            fontSize: 14,
            border: "1px solid var(--primary-15)",
            borderRadius: 8,
            resize: "vertical",
            fontFamily: "inherit",
          }}
        />

        <div
          style={{
            marginTop: 20,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}>
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onStatus(s, notes)}
              disabled={s === quote.status}
              style={{
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 600,
                background:
                  s === quote.status ? "var(--primary-10)" : "var(--primary)",
                color: s === quote.status ? "var(--primary-50)" : "#fff",
                border: "none",
                borderRadius: 8,
                cursor: s === quote.status ? "default" : "pointer",
              }}>
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--primary-50)",
        }}>
        {label}
      </div>
      <div style={{ marginTop: 2, fontSize: 14, color: "var(--ink)", whiteSpace: "pre-wrap" }}>
        {value}
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "10px 14px",
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--primary-60)",
};

const td: React.CSSProperties = {
  padding: "12px 14px",
  fontSize: 13,
  color: "var(--ink)",
};
