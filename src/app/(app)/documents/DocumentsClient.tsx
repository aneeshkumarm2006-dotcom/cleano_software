"use client";

import { useMemo } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, AlertCircle, ChevronRight, FileText } from "lucide-react";

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
}

function formatDate(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function isOverdue(dueDate: string | null) {
  if (!dueDate) return false;
  return new Date(dueDate).getTime() < Date.now();
}

const STATUS_TINT: Record<string, { bg: string; fg: string }> = {
  PENDING:  { bg: "#fffbeb", fg: "#d97706" },
  SIGNED:   { bg: "#dcfce7", fg: "#166534" },
  OVERDUE:  { bg: "#fee2e2", fg: "#b91c1c" },
  EXPIRED:  { bg: "#f1f5f9", fg: "#475569" },
  REVOKED:  { bg: "#fee2e2", fg: "#b91c1c" },
};

export default function DocumentsClient({ signatures }: DocumentsClientProps) {
  const pending = useMemo(() => signatures.filter((s) => s.status === "PENDING"), [signatures]);
  const signed = useMemo(() => signatures.filter((s) => s.status === "SIGNED"), [signatures]);
  const other = useMemo(() => signatures.filter((s) => s.status !== "PENDING" && s.status !== "SIGNED"), [signatures]);

  return (
    <div className="admin-font stack-24">
      <header className="stack-8">
        <p className="eyebrow">HR & Compliance</p>
        <h1 className="display">Documents</h1>
        <p style={{ fontSize: 14, color: "var(--primary-60)" }}>Review and sign documents assigned to you.</p>
      </header>

      <div className="astat-grid">
        <div className="astat">
          <div className="astat-head"><span>Pending</span><span className="astat-icon"><Clock size={15} /></span></div>
          <div className="astat-value" style={pending.length > 0 ? { color: "#d97706" } : {}}>{pending.length}</div>
          {pending.length > 0 && <div className="astat-delta" style={{ color: "#d97706" }}>needs attention</div>}
        </div>
        <div className="astat">
          <div className="astat-head"><span>Signed</span><span className="astat-icon"><CheckCircle2 size={15} /></span></div>
          <div className="astat-value">{signed.length}</div>
        </div>
        <div className="astat">
          <div className="astat-head"><span>Total</span><span className="astat-icon"><FileText size={15} /></span></div>
          <div className="astat-value">{signatures.length}</div>
        </div>
      </div>

      <section>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--primary-50)", marginBottom: 10 }}>
          Pending signature
        </div>
        {pending.length === 0 ? (
          <div className="atable-wrap" style={{ padding: "40px 24px", textAlign: "center", color: "var(--primary-60)" }}>
            You have no pending documents.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pending.map((row) => <DocumentRow key={row.id} row={row} />)}
          </div>
        )}
      </section>

      <section>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--primary-50)", marginBottom: 10 }}>
          Signed
        </div>
        {signed.length === 0 ? (
          <div className="atable-wrap" style={{ padding: "40px 24px", textAlign: "center", color: "var(--primary-60)" }}>
            No signed documents yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {signed.map((row) => <DocumentRow key={row.id} row={row} />)}
          </div>
        )}
      </section>

      {other.length > 0 && (
        <section>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--primary-50)", marginBottom: 10 }}>
            Other
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {other.map((row) => <DocumentRow key={row.id} row={row} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function DocumentRow({ row }: { row: SignatureRow }) {
  const overdue = row.status === "PENDING" && isOverdue(row.document.dueDate);
  const due = formatDate(row.document.dueDate);
  const signedDate = formatDate(row.signedAt);

  let pillKey: string = row.status;
  if (overdue) pillKey = "OVERDUE";
  const tint = STATUS_TINT[pillKey] ?? STATUS_TINT.EXPIRED;

  const pillLabel = overdue ? "Overdue" : row.status.charAt(0) + row.status.slice(1).toLowerCase();
  const PillIcon = overdue ? AlertCircle : row.status === "SIGNED" ? CheckCircle2 : Clock;

  return (
    <Link href={`/documents/${row.document.id}`} className="jcard" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
          <span className="col-client" style={{ fontSize: 15 }}>{row.document.title}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "var(--primary-5)", color: "var(--primary-60)", fontSize: 10, fontWeight: 600, borderRadius: 20, padding: "2px 8px" }}>
            v{row.document.version}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: tint.bg, color: tint.fg, fontSize: 10, fontWeight: 700, borderRadius: 20, padding: "2px 10px" }}>
            <PillIcon size={10} /> {pillLabel}
          </span>
        </div>
        {row.document.description && (
          <div className="col-client-sub" style={{ marginBottom: 4 }}>{row.document.description}</div>
        )}
        <div style={{ fontSize: 11.5, color: "var(--primary-50)", display: "flex", gap: 12 }}>
          {due && row.status === "PENDING" && <span>Due {due}</span>}
          {signedDate && <span>Signed {signedDate}</span>}
        </div>
      </div>
      <ChevronRight size={16} style={{ color: "var(--primary-40)", flexShrink: 0 }} />
    </Link>
  );
}
