"use client";

import { useState, useTransition } from "react";

import {
  approveAccessRequest,
  declineAccessRequest,
  type ActionResult,
  type ApproveResult,
} from "@/lib/console/actions";

/**
 * One waiting request, and the two things that can happen to it.
 *
 * Approving creates a real workspace, so it is behind a confirm step that shows
 * the address first. Declining asks why — not to make it awkward, but because
 * "declined" with no reason is useless the second time the same company writes.
 */
export default function RequestCard({
  id,
  company,
  suggestedSlug,
  contact,
  email,
  canEdit,
}: {
  id: string;
  company: string;
  suggestedSlug: string;
  contact: string;
  email: string;
  canEdit: boolean;
}) {
  const [mode, setMode] = useState<"idle" | "approve" | "decline">("idle");
  const [slug, setSlug] = useState(suggestedSlug);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [created, setCreated] = useState<Extract<ApproveResult, { ok: true }> | null>(null);
  const [busy, start] = useTransition();

  if (created) {
    return (
      <div className="reqfoot" style={{ display: "block" }}>
        <div className="notice good" style={{ marginBottom: 10 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          <div>
            <b>{created.message}</b>
          </div>
        </div>
        <dl className="kv">
          <dt>Address</dt>
          <dd className="mono">{created.slug}.useawer.com</dd>
          <dt>Sign in as</dt>
          <dd className="mono">{created.email}</dd>
          <dt>First password</dt>
          <dd className="mono" style={{ wordBreak: "break-all" }}>
            {created.password}
          </dd>
        </dl>
        <p className="sub" style={{ marginTop: 10 }}>
          Send these to {contact} yourself — Awer does not email them. This password is shown once
          and is stored only as a hash; they are made to change it the first time they sign in.
        </p>
      </div>
    );
  }

  return (
    <div className="reqfoot" style={{ display: "block" }}>
      {mode === "idle" && (
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn primary"
            disabled={!canEdit}
            onClick={() => setMode("approve")}
          >
            Approve and create workspace
          </button>
          <span className="spacer" style={{ flex: 1 }} />
          <button
            type="button"
            className="btn danger"
            disabled={!canEdit}
            onClick={() => setMode("decline")}
          >
            Decline
          </button>
        </div>
      )}

      {mode === "approve" && (
        <>
          <p className="sub" style={{ marginBottom: 10 }}>
            This creates a live workspace for <b>{company}</b> on the Organization plan, with{" "}
            {contact} as its owner. Confirm the address — it is what they will type every day.
          </p>
          <div className="formrow">
            <div className="field">
              <label htmlFor={`slug-${id}`}>Address</label>
              <input
                id={`slug-${id}`}
                type="text"
                value={slug}
                disabled={busy}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
              />
            </div>
            <button
              type="button"
              className="btn primary"
              disabled={busy || slug.trim().length < 3}
              onClick={() =>
                start(async () => {
                  const r = await approveAccessRequest(id, slug);
                  if (r.ok) setCreated(r);
                  else setMsg({ ok: false, message: r.message });
                })
              }
            >
              {busy ? "Creating…" : "Create it"}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setMode("idle")}>
              Cancel
            </button>
          </div>
          <p className="sub" style={{ marginTop: 8 }}>
            Will be <span className="mono">{slug || "…"}.useawer.com</span>
          </p>
        </>
      )}

      {mode === "decline" && (
        <>
          <p className="sub" style={{ marginBottom: 10 }}>
            Nothing is sent to {email}. This records the decision so the next person to read this
            queue knows what happened and why.
          </p>
          <div className="formrow">
            <div className="field">
              <label htmlFor={`note-${id}`}>Why</label>
              <input
                id={`note-${id}`}
                type="text"
                value={note}
                disabled={busy}
                placeholder="e.g. needs on-premise hosting, which we do not offer"
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn danger"
              disabled={busy || note.trim().length < 4}
              onClick={() =>
                start(async () => {
                  setMsg(await declineAccessRequest(id, note));
                })
              }
            >
              {busy ? "Saving…" : "Decline"}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setMode("idle")}>
              Cancel
            </button>
          </div>
        </>
      )}

      {msg && !msg.ok && (
        <div className="notice bad" style={{ marginTop: 10 }} role="status">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
          <div>{msg.message}</div>
        </div>
      )}
    </div>
  );
}
