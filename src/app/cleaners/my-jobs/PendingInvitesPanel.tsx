"use client";

import { useState, useTransition } from "react";
import { respondToJobInvite } from "@/app/admin/actions/respondToJobInvite";
import { fmtDate, fmtTime } from "@/lib/time";

export interface PendingInvite {
  id: string;
  jobId: string;
  jobNumber: number;
  clientName: string;
  startTime: string;
  address: string | null;
  expiresAt: string;
  isLastMinute: boolean;
  bonusUsd: number;
}

function minutesUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 60_000));
}

function fmtSlot(iso: string) {
  // Business timezone, not the device's — matches the rest of the job UI.
  return `${fmtDate(iso, { weekday: "short", month: "short", day: "numeric" })}, ${fmtTime(iso)}`;
}

/**
 * Two panels, not one (awerfixes.pdf item 4).
 *
 * A DIRECT assignment is a confirmation: the cleaner is already on the job and
 * stays on it whether they tap Accept in ten minutes or tomorrow. It showed an
 * "Expires in X min" countdown anyway, which is the "10-minute pending
 * assignment" the client reported — it threatened a release that has not
 * happened since AWER_NEW_FIXES item 2. The countdown is gone from these.
 *
 * A LAST-MINUTE broadcast genuinely is a race for an open job, so it keeps the
 * countdown, the amber treatment and the bonus badge.
 */
export default function PendingInvitesPanel({
  invites,
}: {
  invites: PendingInvite[];
}) {
  const [list, setList] = useState(invites);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (list.length === 0) return null;

  function respond(invite: PendingInvite, decision: "ACCEPT" | "DECLINE") {
    setBusy(invite.id);
    startTransition(async () => {
      const result = await respondToJobInvite({
        inviteId: invite.id,
        decision,
      });
      setBusy(null);
      if (!result.success) {
        alert(result.error ?? "Failed to respond");
        return;
      }
      setList((prev) => prev.filter((i) => i.id !== invite.id));
    });
  }

  const direct = list.filter((i) => !i.isLastMinute);
  const lastMinute = list.filter((i) => i.isLastMinute);

  function renderCard(invite: PendingInvite) {
    return (
      <div
        key={invite.id}
        style={{
          padding: 12,
          border: invite.isLastMinute
            ? "1px solid #f59e0b"
            : "1px solid var(--primary-10)",
          borderRadius: 10,
          background: invite.isLastMinute ? "#fffbeb" : "#fff",
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}>
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>
              #{invite.jobNumber} · {invite.clientName}
            </span>
            {invite.isLastMinute && (
              <span
                style={{
                  padding: "2px 8px",
                  background: "#f59e0b",
                  color: "#fff",
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                }}>
                LAST MIN · +${invite.bonusUsd.toFixed(0)}
              </span>
            )}
          </div>
          <div
            style={{
              marginTop: 4,
              fontSize: 12,
              color: "var(--primary-70)",
            }}>
            {fmtSlot(invite.startTime)}
            {invite.address ? ` · ${invite.address}` : ""}
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 11,
              color: invite.isLastMinute
                ? minutesUntil(invite.expiresAt) <= 2
                  ? "#dc2626"
                  : "var(--primary-50)"
                : "var(--primary-50)",
              fontWeight: 600,
            }}>
            {invite.isLastMinute
              ? minutesUntil(invite.expiresAt) > 0
                ? // A race for an open job — first to accept gets it.
                  `Expires in ${minutesUntil(invite.expiresAt)} min`
                : "Expiring now…"
              : // A direct assignment doesn't lapse. No countdown, because
                // there is nothing counting down: the job is already theirs.
                "This job is yours — tap Accept to confirm."}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            disabled={busy === invite.id}
            onClick={() => respond(invite, "DECLINE")}
            style={{
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 600,
              background: "#fff",
              color: "#dc2626",
              border: "1px solid #fecaca",
              borderRadius: 8,
              cursor: busy === invite.id ? "default" : "pointer",
            }}>
            Decline
          </button>
          <button
            type="button"
            disabled={busy === invite.id}
            onClick={() => respond(invite, "ACCEPT")}
            style={{
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 700,
              background: "var(--primary)",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              cursor: busy === invite.id ? "default" : "pointer",
            }}>
            {busy === invite.id ? "…" : "Accept"}
          </button>
        </div>
      </div>
    );
  }

  function heading(text: string) {
    return (
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--primary-60)",
          marginBottom: 12,
        }}>
        {text}
      </div>
    );
  }

  return (
    <div
      style={{
        marginBottom: 16,
        background: "#fff",
        border: "1px solid var(--primary-15)",
        borderRadius: 14,
        padding: 16,
        display: "grid",
        gap: 16,
      }}>
      {direct.length > 0 && (
        <div>
          {heading(
            direct.length === 1
              ? "New assignment — please confirm"
              : "New assignments — please confirm"
          )}
          <div style={{ display: "grid", gap: 10 }}>{direct.map(renderCard)}</div>
        </div>
      )}
      {lastMinute.length > 0 && (
        <div>
          {heading(
            lastMinute.length === 1
              ? "Last-minute job available"
              : "Last-minute jobs available"
          )}
          <div style={{ display: "grid", gap: 10 }}>
            {lastMinute.map(renderCard)}
          </div>
        </div>
      )}
    </div>
  );
}
