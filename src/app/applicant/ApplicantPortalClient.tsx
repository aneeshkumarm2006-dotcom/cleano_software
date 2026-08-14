"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, FileText, Loader2, Send, Upload } from "lucide-react";
import { Textarea, Button, Banner } from "@/components/customer/Field";
import { uploadApplicantDocument } from "./actions/uploadApplicantDocument";
import { postApplicantMessage } from "./actions/postApplicantMessage";
import {
  APPLICANT_DOCUMENT_ACCEPT,
  validateApplicantDocument,
} from "@/lib/employee-files";

type Status =
  | "NEW"
  | "CONTACTED"
  | "INTERVIEWING"
  | "HIRED"
  | "REJECTED"
  | "ARCHIVED";

const STEPS: { key: Status; label: string }[] = [
  { key: "NEW", label: "Received" },
  { key: "CONTACTED", label: "Contacted" },
  { key: "INTERVIEWING", label: "Interviewing" },
  { key: "HIRED", label: "Hired" },
];

const CARD: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 16,
  padding: 24,
  marginBottom: 20,
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ApplicantPortalClient({
  name,
  application,
  documents,
  messages,
}: {
  name: string;
  application: { status: string; createdAt: string } | null;
  documents: { id: string; fileName: string; uploadedAt: string }[];
  messages: { id: string; authorRole: string; body: string; createdAt: string }[];
}) {
  const router = useRouter();
  const firstName = name.split(/\s+/)[0] || name;

  const status = (application?.status ?? null) as Status | null;
  const isOffPath = status === "REJECTED" || status === "ARCHIVED";
  const stepIndex = status ? STEPS.findIndex((s) => s.key === status) : -1;
  const decided = status === "HIRED" || isOffPath;

  const checklist = [
    { label: "Create your portal account", done: true },
    { label: "Upload your documents", done: documents.length > 0 },
    { label: "Hear back from our team", done: decided },
  ];

  // ── Document upload ────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const invalid = validateApplicantDocument({ size: file.size, type: file.type });
    if (invalid) {
      setUploadMsg({ ok: false, text: invalid });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploading(true);
    setUploadMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadApplicantDocument(fd);
      if (res.success) {
        setUploadMsg({ ok: true, text: "Uploaded." });
        router.refresh();
      } else {
        setUploadMsg({ ok: false, text: res.error });
      }
    } catch {
      setUploadMsg({ ok: false, text: "Failed to upload file" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // ── Messages ────────────────────────────────────────────────────────────
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  async function onSend() {
    if (!draft.trim()) return;
    setSending(true);
    setSendError(null);
    const res = await postApplicantMessage(draft);
    setSending(false);
    if (!res.success) {
      setSendError(res.error);
      return;
    }
    setDraft("");
    router.refresh();
  }

  return (
    <div>
      <header style={{ marginBottom: 28 }}>
        <p className="cl-eyebrow" style={{ marginBottom: 8 }}>
          Applicant portal
        </p>
        <h1 className="cl-display" style={{ fontSize: 28 }}>
          Welcome, {firstName}
        </h1>
      </header>

      {!application ? (
        <Banner kind="error">
          We couldn&apos;t find your application. Please contact us for help.
        </Banner>
      ) : (
        <>
          {/* Status timeline */}
          <section style={CARD}>
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>
              Application status
            </h2>
            {isOffPath ? (
              <Banner kind={status === "ARCHIVED" ? "amber" : "error"}>
                {status === "REJECTED"
                  ? "We've decided not to move forward with your application at this time. Thank you for your interest in Cleano."
                  : "This application has been archived."}
              </Banner>
            ) : (
              <div style={{ display: "flex", alignItems: "center" }}>
                {STEPS.map((step, i) => {
                  const reached = stepIndex >= i;
                  return (
                    <div
                      key={step.key}
                      style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        position: "relative",
                      }}>
                      {i > 0 && (
                        <div
                          style={{
                            position: "absolute",
                            top: 13,
                            right: "50%",
                            width: "100%",
                            height: 2,
                            background: reached ? "var(--primary)" : "#e5e7eb",
                            zIndex: 0,
                          }}
                        />
                      )}
                      <div
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: "50%",
                          background: reached ? "var(--primary)" : "#e5e7eb",
                          color: reached ? "#fff" : "#94a3b8",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 12,
                          fontWeight: 700,
                          zIndex: 1,
                        }}>
                        {reached ? <Check size={14} /> : i + 1}
                      </div>
                      <span
                        style={{
                          marginTop: 8,
                          fontSize: 12,
                          fontWeight: 600,
                          color: reached ? "var(--primary)" : "#94a3b8",
                          textAlign: "center",
                        }}>
                        {step.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <p style={{ marginTop: 16, fontSize: 12.5, color: "#64748b" }}>
              Applied {fmtDate(application.createdAt)}
            </p>
          </section>

          {/* Onboarding checklist */}
          <section style={CARD}>
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>
              Onboarding checklist
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {checklist.map((item) => (
                <div
                  key={item.label}
                  style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: item.done ? "var(--emerald-100, #d1fae5)" : "#f1f5f9",
                      color: item.done ? "var(--emerald-800, #065f46)" : "#94a3b8",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}>
                    {item.done ? <Check size={12} /> : null}
                  </span>
                  <span
                    style={{
                      fontSize: 13.5,
                      color: item.done ? "#0a1f24" : "#64748b",
                      textDecoration: item.done ? "none" : "none",
                    }}>
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Documents */}
          <section style={CARD}>
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
              Documents
            </h2>
            <p style={{ fontSize: 13, color: "#64748b", marginBottom: 14 }}>
              Upload any documents our team has requested. PDF, JPG or PNG, up
              to 8MB.
            </p>

            {documents.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                {documents.map((d) => (
                  <div
                    key={d.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      borderRadius: 10,
                      background: "#f7faf9",
                    }}>
                    <FileText size={15} style={{ color: "var(--primary)", flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 600, wordBreak: "break-all" }}>
                      {d.fileName}
                    </span>
                    <span style={{ fontSize: 12, color: "#64748b", marginLeft: "auto" }}>
                      {fmtDate(d.uploadedAt)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 14 }}>
                No documents uploaded yet.
              </p>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept={APPLICANT_DOCUMENT_ACCEPT}
              onChange={onPickFile}
              disabled={uploading}
              style={{ display: "none" }}
              id="applicant-document-input"
            />
            <Button
              type="button"
              variant="secondary"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}>
              {uploading ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Uploading…
                </>
              ) : (
                <>
                  <Upload size={14} /> Upload a document
                </>
              )}
            </Button>

            {uploadMsg ? (
              <p
                style={{
                  marginTop: 10,
                  fontSize: 12.5,
                  color: uploadMsg.ok ? "var(--emerald-800, #065f46)" : "var(--error-text, #dc2626)",
                }}>
                {uploadMsg.text}
              </p>
            ) : null}
          </section>

          {/* Messages */}
          <section style={CARD}>
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
              Messages
            </h2>
            <p style={{ fontSize: 13, color: "#64748b", marginBottom: 14 }}>
              Requests from our team, and your replies.
            </p>

            {messages.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                {messages.map((m) => {
                  const fromApplicant = m.authorRole === "APPLICANT";
                  return (
                    <div
                      key={m.id}
                      style={{
                        alignSelf: fromApplicant ? "flex-end" : "flex-start",
                        maxWidth: "85%",
                      }}>
                      <div
                        style={{
                          background: fromApplicant ? "var(--primary)" : "#f1f5f4",
                          color: fromApplicant ? "#fff" : "#0a1f24",
                          borderRadius: 12,
                          padding: "10px 14px",
                          fontSize: 13.5,
                          lineHeight: 1.5,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}>
                        {m.body}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "#94a3b8",
                          marginTop: 4,
                          textAlign: fromApplicant ? "right" : "left",
                        }}>
                        {fromApplicant ? "You" : "Cleano team"} · {fmtDate(m.createdAt)}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 16 }}>
                No messages yet.
              </p>
            )}

            <Textarea
              rows={3}
              placeholder="Write a reply…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            {sendError ? (
              <p style={{ marginTop: 8, fontSize: 12.5, color: "var(--error-text, #dc2626)" }}>
                {sendError}
              </p>
            ) : null}
            <div style={{ marginTop: 10 }}>
              <Button
                type="button"
                loading={sending}
                disabled={sending || !draft.trim()}
                onClick={onSend}>
                <Send size={14} /> Send
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
