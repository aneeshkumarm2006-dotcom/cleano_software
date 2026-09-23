"use client";

// "Save this as a template", on a job whose checklist was typed by hand.
//
// It only appears when the job resolves to a CUSTOM checklist, because that is
// the only state where anything here is worth reusing: every other tier is
// already coming FROM a template. Showing it elsewhere would offer to save a
// copy of something that already exists.
//
// Collapsed until asked. A job page is long and this is a once-per-checklist
// action, so it earns a link, not a permanent form.

import { useState, useTransition } from "react";

import { saveChecklistAsTemplate } from "../../actions/saveChecklistAsTemplate";

export default function SaveChecklistTemplate({
  jobId,
  jobType,
  clientName,
}: {
  jobId: string;
  jobType: string | null;
  clientName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [toClient, setToClient] = useState(false);
  const [toJobType, setToJobType] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function submit() {
    startTransition(async () => {
      setError(null);
      const res = await saveChecklistAsTemplate({
        jobId,
        name,
        scopeToClient: toClient,
        scopeToJobType: toJobType,
      });
      if (res.success) {
        setSaved(
          `Saved "${name.trim()}" with ${res.itemCount} step${res.itemCount === 1 ? "" : "s"}. It's in Settings → Checklist Templates.`,
        );
        setOpen(false);
      } else {
        setError(res.error);
      }
    });
  }

  if (saved) {
    return (
      <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "#047857" }}>
        {saved}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          marginTop: 10,
          background: "transparent",
          border: "none",
          padding: 0,
          fontSize: 12.5,
          fontWeight: 600,
          color: "var(--primary)",
          textDecoration: "underline",
          cursor: "pointer",
        }}>
        Save this checklist as a template
      </button>
    );
  }

  return (
    <div
      style={{
        marginTop: 10,
        padding: 12,
        borderRadius: 10,
        background: "var(--primary-5)",
        border: "1px solid var(--primary-15)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--primary-60)", lineHeight: 1.6 }}>
        Takes a copy of the steps as they are now. This booking keeps its own
        list, and editing it later won&apos;t change the template.
      </p>

      <label style={{ fontSize: 11, fontWeight: 700, color: "var(--primary-70)" }}>
        Template name
        <input
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Move-out deep clean"
          style={{
            width: "100%",
            marginTop: 3,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid var(--primary-20)",
            fontSize: 13,
          }}
        />
      </label>

      {/* Both off by default, which makes the template global. That is the
          least surprising default: an admin who wants it everywhere does
          nothing, and narrowing is an explicit choice they can see. */}
      {clientName && (
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, color: "var(--ink-soft)" }}>
          <input
            type="checkbox"
            checked={toClient}
            onChange={(e) => setToClient(e.target.checked)}
          />
          Only for {clientName}
        </label>
      )}
      {jobType && (
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, color: "var(--ink-soft)" }}>
          <input
            type="checkbox"
            checked={toJobType}
            onChange={(e) => setToJobType(e.target.checked)}
          />
          Only for {jobType} jobs
        </label>
      )}

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "#b91c1c" }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          disabled={pending || !name.trim()}
          onClick={submit}
          style={{
            padding: "8px 14px",
            borderRadius: 999,
            border: "none",
            background: "var(--primary)",
            color: "#fff",
            fontSize: 12.5,
            fontWeight: 600,
            cursor: "pointer",
            opacity: pending || !name.trim() ? 0.6 : 1,
          }}>
          {pending ? "Saving…" : "Save template"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          style={{
            padding: "8px 14px",
            borderRadius: 999,
            border: "1px solid var(--primary-20)",
            background: "transparent",
            fontSize: 12.5,
            cursor: "pointer",
            color: "var(--primary-70)",
          }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
