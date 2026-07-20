"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import SignatureCanvas from "react-signature-canvas";
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Check,
  PenLine,
  FileText,
  Download,
} from "lucide-react";
import { signDocument } from "../../actions/signDocument";
import { logDocumentAccess } from "../../actions/logDocumentAccess";

type DocStatus = "PENDING" | "SIGNED" | "EXPIRED" | "REVOKED";

interface DocumentData {
  id: string;
  title: string;
  description: string | null;
  content: string | null;
  fileUrl: string | null;
  version: string;
  dueDate: string | null;
}

interface SignatureData {
  status: DocStatus;
  signedAt: string | null;
  signatureUrl: string | null;
}

interface SignerData {
  name: string;
}

interface DocumentSigningViewProps {
  document: DocumentData;
  signature: SignatureData;
  signer: SignerData;
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
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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

export default function DocumentSigningView({
  document,
  signature,
  signer,
}: DocumentSigningViewProps) {
  const router = useRouter();
  const roleBase = usePathname().startsWith("/cleaners") ? "/cleaners" : "/admin";
  const sigRef = useRef<SignatureCanvas>(null);
  const [agreed, setAgreed] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Item 20: record that this staff member OPENED the document (once per mount)
  // so the access log reflects reads, not just downloads/completions.
  const loggedOpenRef = useRef(false);
  useEffect(() => {
    if (loggedOpenRef.current) return;
    loggedOpenRef.current = true;
    logDocumentAccess(document.id, "OPEN").catch(() => {});
  }, [document.id]);

  const signable = signature.status === "PENDING";

  function clearSignature() {
    sigRef.current?.clear();
    setHasInk(false);
  }

  async function handleSubmit() {
    if (!agreed || !hasInk || !sigRef.current || sigRef.current.isEmpty()) return;

    setSaving(true);
    setError(null);

    const dataUrl = sigRef.current.toDataURL("image/png");
    const res = await signDocument({
      documentId: document.id,
      signatureDataUrl: dataUrl,
    });

    if (res.success) {
      router.push(`${roleBase}/documents`);
      router.refresh();
    } else {
      setError(res.error || "Failed to sign document.");
      setSaving(false);
    }
  }

  return (
    <div className="admin-font">
      <button className="jdetail-back" onClick={() => router.push(`${roleBase}/documents`)}>
        <ArrowLeft size={14} /> Back to Documents
      </button>

      <div className="doc-detail">
        {/* Document content */}
        <div className="doc-paper-wrap">
          <div className="doc-paper-head">
            <div>
              <p className="eyebrow">HR &amp; Compliance</p>
              <h1 className="title" style={{ fontSize: 28, marginTop: 4 }}>
                {document.title}
              </h1>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="doc-ver">v{document.version}</span>
              <DocStatusPill status={signature.status} />
            </div>
          </div>
          <div className="doc-paper">
            {document.fileUrl ? (
              <div className="doc-pdf-placeholder">
                <FileText size={40} />
                <div style={{ fontWeight: 600 }}>
                  {document.title} · v{document.version}
                </div>
                <div style={{ fontSize: 13, color: "var(--primary-50)" }}>
                  PDF preview ({document.title.replace(/\s/g, "_")}.pdf)
                </div>
                <a
                  href={document.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary btn-sm"
                  style={{ marginTop: 12, textDecoration: "none" }}
                  onClick={() => {
                    // Fire-and-forget download tracking (item 20).
                    logDocumentAccess(document.id, "DOWNLOAD").catch(() => {});
                  }}>
                  <Download size={14} /> Download PDF
                </a>
              </div>
            ) : document.content ? (
              <div className="doc-text" style={{ whiteSpace: "pre-wrap" }}>
                {document.content}
              </div>
            ) : (
              <div className="doc-text">
                <p>
                  This acknowledgement confirms that the undersigned has received, read, and
                  understood the contents of <strong>{document.title}</strong> (v{document.version}
                  ).
                </p>
                <p>
                  {document.description ? `${document.description} ` : ""}By signing below, you agree
                  to comply with all policies and procedures described herein, and understand that
                  violation may result in disciplinary action up to and including termination.
                </p>
                <p>
                  This document supersedes all prior versions. Questions may be directed to the HR
                  department at any time.
                </p>
                <ul>
                  <li>I have read the document in its entirety.</li>
                  <li>I understand my obligations under these terms.</li>
                  <li>I am signing voluntarily and electronically.</li>
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Sign or signed view */}
        {signable ? (
          <div className="dcard doc-sign">
            <div className="dcard-head">
              <h3>Your signature</h3>
            </div>
            <p style={{ fontSize: 13.5, color: "var(--primary-60)", margin: 0 }}>
              Draw your signature in the box below.
            </p>
            <div className="doc-canvas-wrap">
              <SignatureCanvas
                ref={sigRef}
                penColor="#0e1a1c"
                canvasProps={{ className: "doc-canvas" }}
                onEnd={() => setHasInk(true)}
              />
              {!hasInk ? <span className="doc-canvas-hint">Sign here</span> : null}
              <span className="doc-canvas-x">✕</span>
            </div>
            <div className="doc-canvas-actions">
              <button
                className="link-muted"
                style={{ background: "none", border: 0, cursor: "pointer", fontSize: 13 }}
                onClick={clearSignature}>
                Clear
              </button>
            </div>
            <label className="doc-agree">
              <span
                className={`doc-check ${agreed ? "on" : ""}`}
                onClick={() => setAgreed((a) => !a)}>
                {agreed ? <Check size={13} /> : null}
              </span>
              <span onClick={() => setAgreed((a) => !a)}>
                I have read and agree to the terms set out in <strong>{document.title}</strong>, and
                I am signing this document electronically.
              </span>
            </label>
            {error ? (
              <div className="banner banner-amber" style={{ margin: 0 }}>
                <AlertCircle size={16} /> {error}
              </div>
            ) : null}
            <button
              className="btn btn-primary btn-block"
              disabled={!agreed || !hasInk || saving}
              onClick={handleSubmit}>
              <PenLine size={16} /> {saving ? "Signing…" : "Sign document"}
            </button>
            <p
              style={{
                fontSize: 11.5,
                color: "var(--primary-40)",
                textAlign: "center",
                margin: 0,
              }}>
              Your signature and a timestamp will be recorded.
            </p>
          </div>
        ) : (
          <div className="dcard doc-sign">
            <div className="dcard-head">
              <h3>Signature on file</h3>
            </div>
            {signature.status === "SIGNED" ? (
              <>
                <div className="doc-signed-box">
                  {signature.signatureUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={signature.signatureUrl}
                      alt="signature"
                      style={{ maxWidth: "100%", maxHeight: 90 }}
                    />
                  ) : (
                    <span
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontStyle: "italic",
                        fontSize: 30,
                        color: "var(--ink)",
                      }}>
                      {signer.name}
                    </span>
                  )}
                </div>
                <div className="banner banner-success" style={{ margin: 0 }}>
                  <CheckCircle2 size={16} /> Signed on {formatDate(signature.signedAt)} · v
                  {document.version}
                </div>
              </>
            ) : (
              <div className="banner banner-amber" style={{ margin: 0 }}>
                <AlertCircle size={16} /> This document is {signature.status.toLowerCase()} and can
                no longer be signed.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
