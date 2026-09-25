"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Check, Loader2, ShieldCheck, Upload } from "lucide-react";
import { uploadVoidCheque } from "../actions/uploadVoidCheque";
import type { MyVoidCheque } from "../actions/getMyVoidCheque";
import {
  VOID_CHEQUE_ACCEPT,
  VOID_CHEQUE_LABEL,
  validateVoidCheque,
} from "@/lib/employee-files";

/**
 * The cleaner's payroll upload card (awerfixes.pdf item 16).
 *
 * Rendered ONLY on the cleaner route — see the `!isAdminView` gate in
 * DocumentsClient. Deliberately shows the filename and date rather than a View
 * link: decision 7 puts every read of a banking document behind the
 * OWNER/ADMIN action that signs and logs it, so there is no second, unlogged
 * way to open one. "Is the right file on record?" is answerable from the name
 * and date; anything more is Replace.
 */
export default function VoidChequeCard({
  current,
}: {
  current: MyVoidCheque | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Same rule the server applies — src/lib/employee-files.ts. Checking here
    // too means an oversized file is refused instantly instead of after the
    // upload the server was always going to reject.
    const invalid = validateVoidCheque({ size: file.size, type: file.type });
    if (invalid) {
      setMsg({ ok: false, text: invalid });
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadVoidCheque(fd);
      if (res.success) {
        setMsg({ ok: true, text: "Saved. Payroll can see it now." });
        router.refresh();
      } else {
        setMsg({ ok: false, text: res.error });
      }
    } catch {
      setMsg({ ok: false, text: "Failed to upload file" });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="jcard" style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <Banknote size={16} style={{ color: "var(--primary)" }} />
        <strong style={{ fontSize: 14.5 }}>{VOID_CHEQUE_LABEL}</strong>
      </div>
      <p className="subtitle" style={{ fontSize: 13, marginBottom: 14 }}>
        Upload a void cheque or your bank&apos;s direct deposit form so payroll can
        pay you. PDF, JPG or PNG, up to 8MB.
      </p>

      {current ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            borderRadius: 10,
            background: "var(--emerald-100)",
            color: "var(--emerald-800)",
            marginBottom: 14,
            flexWrap: "wrap",
          }}>
          <Check size={15} />
          <span style={{ fontSize: 13, fontWeight: 600, wordBreak: "break-all" }}>
            {current.fileName}
          </span>
          <span style={{ fontSize: 12, opacity: 0.8 }}>
            uploaded{" "}
            {new Date(current.uploadedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>
      ) : (
        <div className="doc-empty" style={{ marginBottom: 14 }}>
          No banking document on file yet.
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={VOID_CHEQUE_ACCEPT}
        onChange={onPick}
        disabled={busy}
        style={{ display: "none" }}
        id="void-cheque-input"
      />
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={busy}
        onClick={() => inputRef.current?.click()}>
        {busy ? (
          <>
            <Loader2 size={14} className="animate-spin" /> Uploading…
          </>
        ) : (
          <>
            <Upload size={14} /> {current ? "Replace" : "Upload"}
          </>
        )}
      </button>

      {msg && (
        <p
          style={{
            marginTop: 10,
            fontSize: 12.5,
            color: msg.ok ? "var(--emerald-800)" : "var(--error-text)",
          }}>
          {msg.text}
        </p>
      )}

      <p
        style={{
          marginTop: 12,
          fontSize: 11.5,
          color: "var(--slate-700)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}>
        <ShieldCheck size={13} />
        Stored privately. Only the owner and admins can open it, and every view is
        logged.
      </p>
    </div>
  );
}
