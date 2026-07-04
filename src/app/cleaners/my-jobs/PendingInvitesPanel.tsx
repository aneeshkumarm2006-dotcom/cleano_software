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

  return (
    <div
      style={{
        marginBottom: 16,
        background: "#fff",
        border: "1px solid var(--primary-15)",
        borderRadius: 14,
        padding: 16,
      }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--primary-60)",
          marginBottom: 12,
        }}>
        Pending assignment{list.length === 1 ? "" : "s"}
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {list.map((invite) => {
          const mins = minutesUntil(invite.expiresAt);
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
                    color: mins <= 2 ? "#dc2626" : "var(--primary-50)",
                    fontWeight: 600,
                  }}>
                  {mins > 0
                    ? `Expires in ${mins} min`
                    : "Expiring now…"}
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
        })}
      </div>
    </div>
  );
}
