"use client";

import { useState } from "react";
import useSWR from "swr";
import { MessageSquareOff, ShieldOff } from "lucide-react";
import {
  getJobChatModeration,
  setJobChatDisabled,
  setParticipantChatDisabled,
  type JobChatModerationDTO,
} from "@/app/admin/actions/jobChatModeration";

/**
 * Admin messaging controls for one booking's chat thread (CLN-P0-3-14).
 *
 * Deliberately sits directly under the thread on the job page: the moment an
 * admin decides to close a conversation is the moment they are reading it, and
 * a control on some other settings screen would never be found.
 *
 * Two levels, matching the spec's "a specific booking or user" — the booking
 * itself, and each participant across all of their bookings. The per-participant
 * switch says so on its face, because "block" that silently reaches other jobs
 * would be a nasty surprise.
 */
export default function JobChatModeration({ jobId }: { jobId: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, mutate } = useSWR<JobChatModerationDTO | null>(
    ["job-chat-moderation", jobId],
    async () => {
      const res = await getJobChatModeration(jobId);
      // A non-OWNER/ADMIN viewer simply gets no panel rather than an error box.
      return res.success ? res.data : null;
    }
  );

  if (!data) return null;

  const bookingOff = data.chatDisabledAt !== null;

  async function toggleBooking() {
    if (busy) return;
    setBusy("booking");
    setError(null);
    const res = await setJobChatDisabled(jobId, !bookingOff);
    if (!res.success) setError(res.error);
    await mutate();
    setBusy(null);
  }

  async function toggleParticipant(
    kind: "client" | "cleaner",
    id: string,
    currentlyOff: boolean
  ) {
    if (busy) return;
    setBusy(id);
    setError(null);
    const res = await setParticipantChatDisabled({
      kind,
      id,
      disabled: !currentlyOff,
      jobId,
    });
    if (!res.success) setError(res.error);
    await mutate();
    setBusy(null);
  }

  return (
    <div style={{ marginTop: 14, borderTop: "1px solid var(--primary-10)", paddingTop: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--primary-60)",
          marginBottom: 10,
        }}>
        <MessageSquareOff size={13} />
        Messaging controls
      </div>

      <div className="pay-toggle">
        <div className="pay-toggle-info">
          <div className="label-stack">
            <span className="top">Messaging on this booking</span>
            <span className="bottom">
              {bookingOff
                ? "Off — the cleaner and the customer can read this thread but not reply. You can still post."
                : "On — the cleaner and the customer can message each other about this job."}
            </span>
          </div>
        </div>
        <button
          type="button"
          className={`tswitch ${bookingOff ? "" : "on"}`}
          onClick={toggleBooking}
          disabled={busy !== null}
          role="switch"
          aria-checked={!bookingOff}
          aria-label="Toggle messaging for this booking"
        />
      </div>

      {data.participants.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11.5,
              color: "var(--primary-50)",
              marginBottom: 6,
            }}>
            <ShieldOff size={12} />
            Block a person everywhere — applies to every booking they are on, not
            just this one.
          </div>
          {data.participants.map((p) => {
            const off = p.chatDisabledAt !== null;
            return (
              <div key={`${p.kind}-${p.id}`} className="pay-toggle">
                <div className="pay-toggle-info">
                  <div className="label-stack">
                    <span className="top">
                      {p.name}{" "}
                      <span style={{ color: "var(--primary-50)", fontWeight: 500 }}>
                        · {p.kind === "client" ? "Customer" : "Cleaner"}
                      </span>
                    </span>
                    <span className="bottom">
                      {off
                        ? "Blocked from job chat on all bookings."
                        : "Can message on any booking they are part of."}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className={`tswitch ${off ? "" : "on"}`}
                  onClick={() => toggleParticipant(p.kind, p.id, off)}
                  disabled={busy !== null}
                  role="switch"
                  aria-checked={!off}
                  aria-label={`Toggle job chat for ${p.name}`}
                />
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <p style={{ fontSize: 12, color: "#dc2626", margin: "8px 0 0" }}>{error}</p>
      )}
    </div>
  );
}
