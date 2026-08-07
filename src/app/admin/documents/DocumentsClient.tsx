"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  ChevronRight,
  FileText,
  Check,
} from "lucide-react";
import VoidChequeCard from "./VoidChequeCard";
import type { MyVoidCheque } from "../actions/getMyVoidCheque";

type DocStatus = "PENDING" | "SIGNED" | "EXPIRED" | "REVOKED";

interface SignatureRow {
  id: string;
  status: DocStatus;
  signedAt: string | null;
  document: {
    id: string;
    title: string;
    description: string | null;
    version: string;
    dueDate: string | null;
    createdAt: string;
    hasFile: boolean;
  };
}

interface DocumentsClientProps {
  signatures: SignatureRow[];
  /** The viewer's own void cheque, metadata only. Null when none is on file. */
  voidCheque: MyVoidCheque | null;
}

const STATUS: Record<
  DocStatus,
  { label: string; dot: string; bg: string; fg: string }
> = {
  PENDING: { label: "Pending", dot: "#d97706", bg: "var(--amber-50)", fg: "var(--amber-800)" },
  SIGNED: { label: "Signed", dot: "#059669", bg: "var(--emerald-100)", fg: "var(--emerald-800)" },
  EXPIRED: { label: "Expired", dot: "#64748b", bg: "var(--slate-100)", fg: "var(--slate-700)" },
  REVOKED: { label: "Revoked", dot: "#dc2626", bg: "var(--error-bg)", fg: "var(--error-text)" },
};

function formatDate(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function daysUntil(value: string) {
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86400000);
}

function DocStatusPill({ status }: { status: DocStatus }) {
  const m = STATUS[status];
  return (
    <span className="pill" style={{ background: m.bg, color: m.fg }}>
      <span className="pill-dot" style={{ background: m.dot }} />
      {m.label}
    </span>
  );
}

export default function DocumentsClient({
  signatures,
  voidCheque,
}: DocumentsClientProps) {
  const isAdminView = usePathname().startsWith("/admin");
  const pending = useMemo(() => signatures.filter((s) => s.status === "PENDING"), [signatures]);
  const signed = useMemo(() => signatures.filter((s) => s.status === "SIGNED"), [signatures]);
  const other = useMemo(
    () => signatures.filter((s) => s.status === "EXPIRED" || s.status === "REVOKED"),
    [signatures]
  );

  const sections: { title: string; rows: SignatureRow[]; accent?: boolean }[] = [
    { title: "Pending signature", rows: pending, accent: true },
    { title: "Signed", rows: signed },
    { title: "Other", rows: other },
  ];

  return (
    <div className="admin-font">
      <header style={{ marginBottom: 26 }}>
        <p className="eyebrow">HR &amp; Compliance</p>
        <h1 className="display" style={{ fontSize: "clamp(32px, 4.2vw, 46px)", marginTop: 6 }}>
          Documents.
        </h1>
        <p className="subtitle" style={{ marginTop: 10, fontSize: 15.5 }}>
          Review, sign, and keep your compliance paperwork up to date.
        </p>
      </header>

      {isAdminView && (
        <div
          style={{
            marginBottom: 24,
            padding: "12px 16px",
            borderRadius: 12,
            background: "var(--primary-5, rgba(0,140,156,0.06))",
            border: "1px solid rgba(0,140,156,0.18)",
            fontSize: 13.5,
            color: "var(--primary)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}>
          <FileText size={15} />
          <span>This is your personal signing view. To create, assign, or remove team documents, go to</span>
          <Link href="/admin/settings" style={{ fontWeight: 700, textDecoration: "underline" }}>
            Settings → Documents
          </Link>
          .
        </div>
      )}

      <div
        className="astat-grid"
        style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))", marginBottom: 32 }}>
        <Stat
          icon={<AlertCircle size={16} />}
          label="Pending"
          value={pending.length}
          hint={pending.length ? "awaiting your signature" : "all caught up"}
        />
        <Stat icon={<CheckCircle2 size={16} />} label="Signed" value={signed.length} hint="on file" />
        <Stat icon={<FileText size={16} />} label="Total" value={signatures.length} hint="documents" />
      </div>

      {/*
        Cleaner route only (awerfixes.pdf item 16). This page is shared with
        /admin/documents via a re-export, and the same `isAdminView` path check
        that hides the settings banner from cleaners hides this from admins —
        an admin manages payroll paperwork from the employee's detail page, not
        from their own personal signing view.
      */}
      {!isAdminView && (
        <section style={{ marginBottom: 30 }}>
          <div className="doc-sec-head">
            <h2 className="doc-sec-title">Payroll documents</h2>
          </div>
          <VoidChequeCard current={voidCheque} />
        </section>
      )}

      {sections.map((sec) => (
        <section key={sec.title} style={{ marginBottom: 30 }}>
          <div className="doc-sec-head">
            <h2 className="doc-sec-title">{sec.title}</h2>
            <span className="doc-sec-count">{sec.rows.length}</span>
          </div>
          {sec.rows.length === 0 ? (
            <div className="doc-empty">
              {sec.title === "Pending signature"
                ? "Nothing waiting on you — nice."
                : `No ${sec.title.toLowerCase()} documents.`}
            </div>
          ) : (
            <div className="doc-list">
              {sec.rows.map((row) => (
                <DocumentCard key={row.id} row={row} accent={!!sec.accent} />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="astat">
      <div className="astat-head">
        <span>{label}</span>
        <span className="astat-icon">{icon}</span>
      </div>
      <div className="astat-value">{value}</div>
      {hint ? <div className="astat-delta">{hint}</div> : null}
    </div>
  );
}

function DocumentCard({ row, accent }: { row: SignatureRow; accent: boolean }) {
  const { document: d } = row;
  const roleBase = usePathname().startsWith("/cleaners") ? "/cleaners" : "/admin";
  const days = d.dueDate ? daysUntil(d.dueDate) : null;
  const overdue = row.status === "PENDING" && days !== null && days < 0;
  const dueSoon = row.status === "PENDING" && days !== null && days >= 0 && days <= 3;

  return (
    <Link
      href={`${roleBase}/documents/${d.id}`}
      className={`jcard doc-card ${accent ? "accent" : ""}`}>
      <span className="doc-card-icon">
        <FileText size={18} />
      </span>
      <div className="doc-card-body">
        <div className="doc-card-toprow">
          <span className="jcard-client">{d.title}</span>
          <span className="doc-ver">v{d.version}</span>
        </div>
        {d.description && <div className="doc-card-sub">{d.description}</div>}
        <div className="doc-card-meta">
          <DocStatusPill status={row.status} />
          {row.status === "PENDING" && d.dueDate ? (
            <span className={`doc-due ${overdue ? "overdue" : dueSoon ? "soon" : ""}`}>
              <Clock size={13} /> Due {formatDate(d.dueDate)}
              {overdue ? " · overdue" : dueSoon ? " · soon" : ""}
            </span>
          ) : row.signedAt ? (
            <span className="doc-due">
              <Check size={13} /> Signed {formatDate(row.signedAt)}
            </span>
          ) : null}
        </div>
      </div>
      <span className="doc-card-chev">
        <ChevronRight size={18} />
      </span>
    </Link>
  );
}
