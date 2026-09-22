"use client";

// "These times are wrong" — from the cleaner's side (Sept 17 list, item 19).
//
// Until this existed a cleaner who missed a clock-in had two options: message
// the office and hope it got actioned, or work the hours unpaid. Neither left
// a record, so a month later nobody could reconstruct whose fault it was.
//
// Nothing here changes payroll. It sends a request; an admin approving it is
// what moves the clock.

import { useState, useTransition } from "react";

import { requestTimeLogChange } from "../../actions/timeLogRequests";
import { storeInputParts, storeWallClockToUtc } from "@/lib/timezone";

export interface TimeLogRequestHistoryRow {
  id: string;
  status: string;
  reason: string;
  decisionNote: string | null;
  createdAt: string;
}

interface Props {
  jobId: string;
  /** The session being corrected, when the job has session rows. */
  sessionId: string | null;
  currentStart: string | null;
  currentEnd: string | null;
  history: TimeLogRequestHistoryRow[];
}

/** An ISO instant → the date + time pair the inputs want, in the job's clock. */
function toParts(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  return storeInputParts(new Date(iso));
}

export default function TimeLogRequestControl({
  jobId,
  sessionId,
  currentStart,
  currentEnd,
  history,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const startParts = toParts(currentStart);
  const endParts = toParts(currentEnd);

  const [startDate, setStartDate] = useState(startParts.date);
  const [startTime, setStartTime] = useState(startParts.time);
  const [endDate, setEndDate] = useState(endParts.date);
  const [endTime, setEndTime] = useState(endParts.time);
  const [reason, setReason] = useState("");

  const waiting = history.find((h) => h.status === "PENDING");

  function submit() {
    startTransition(async () => {
      setError(null);
      // The inputs are WALL CLOCK in the business timezone, which is the clock
      // every other time on this page is printed in. Reading them with
      // `new Date("2026-09-22T09:00")` would interpret them as the phone's
      // local time — so a cleaner correcting a Montreal job from Calgary would
      // send a time two hours out from the one they typed.
      const toIso = (d: string, t: string) =>
        d && t ? storeWallClockToUtc(d, t).toISOString() : null;

      const res = await requestTimeLogChange({
        jobId,
        sessionId,
        requestedStart: toIso(startDate, startTime),
        requestedEnd: toIso(endDate, endTime),
        reason,
      });
      if (res.success) {
        setSent(true);
        setOpen(false);
      } else {
        setError(res.error);
      }
    });
  }

  if (sent || waiting) {
    return (
      <p className="cl-jd-dim" style={{ fontSize: 12, marginTop: 8 }}>
        A correction is with the office. You&apos;ll see the new times here once
        it&apos;s approved.
      </p>
    );
  }

  const lastDecided = history.find((h) => h.status !== "PENDING");

  return (
    <div style={{ marginTop: 8 }}>
      {!open ? (
        <>
          <button
            type="button"
            onClick={() => setOpen(true)}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              fontSize: 12,
              fontWeight: 600,
              color: "var(--primary)",
              textDecoration: "underline",
              cursor: "pointer",
            }}>
            These times are wrong
          </button>
          {lastDecided && (
            <p className="cl-jd-dim" style={{ fontSize: 11, marginTop: 4 }}>
              Your last request was {lastDecided.status.toLowerCase()}
              {lastDecided.decisionNote ? ` — ${lastDecided.decisionNote}` : ""}.
            </p>
          )}
        </>
      ) : (
        <div
          style={{
            marginTop: 6,
            padding: 12,
            borderRadius: 12,
            background: "var(--primary-5)",
            border: "1px solid var(--primary-15)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}>
          <p style={{ fontSize: 12, margin: 0, color: "var(--ink-soft)" }}>
            Put in the times you actually worked. The office has to approve it
            before your hours change.
          </p>

          <label style={{ fontSize: 11, fontWeight: 600, color: "var(--primary-70)" }}>
            Clocked in
            <div style={{ display: "flex", gap: 6, marginTop: 3 }}>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                aria-label="Clock-in date"
                style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--primary-20)", fontSize: 13 }}
              />
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                aria-label="Clock-in time"
                style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--primary-20)", fontSize: 13 }}
              />
            </div>
          </label>

          <label style={{ fontSize: 11, fontWeight: 600, color: "var(--primary-70)" }}>
            Clocked out
            <div style={{ display: "flex", gap: 6, marginTop: 3 }}>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                aria-label="Clock-out date"
                style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--primary-20)", fontSize: 13 }}
              />
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                aria-label="Clock-out time"
                style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--primary-20)", fontSize: 13 }}
              />
            </div>
          </label>

          <label style={{ fontSize: 11, fontWeight: 600, color: "var(--primary-70)" }}>
            What happened
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. Phone died, I started at 8:45."
              style={{ width: "100%", marginTop: 3, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--primary-20)", fontSize: 13, fontFamily: "inherit" }}
            />
          </label>

          {error && (
            <p role="alert" style={{ fontSize: 12, color: "#b91c1c", margin: 0 }}>
              {error}
            </p>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              disabled={pending}
              onClick={submit}
              style={{
                flex: 1,
                padding: "9px 14px",
                borderRadius: 999,
                border: "none",
                background: "var(--primary)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                opacity: pending ? 0.6 : 1,
              }}>
              {pending ? "Sending…" : "Send to the office"}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setError(null); }}
              style={{
                padding: "9px 14px",
                borderRadius: 999,
                border: "1px solid var(--primary-20)",
                background: "transparent",
                fontSize: 13,
                cursor: "pointer",
                color: "var(--primary-70)",
              }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
