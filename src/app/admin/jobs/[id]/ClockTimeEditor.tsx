"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Loader, AlertTriangle, Trash2 } from "lucide-react";
import Modal from "@/components/ui/Modal";
import DatePicker from "@/components/ui/DatePicker";
import TimePicker from "@/components/ui/TimePicker";
import { tzInputParts, tzWallClockToUtc } from "@/lib/time";
import {
  deleteJobWorkSession,
  updateClockTimes,
} from "../../actions/updateClockTimes";

/**
 * Admin editor for a job's (or one cleaner's) clock-in / clock-out times
 * (new fix list item 4).
 *
 * Inputs are wall-clock in the BUSINESS timezone — same convention as the job
 * modal — so an admin in another zone doesn't shift the shift. Clearing both
 * fields wipes the times, which is how a mistaken clock-in gets undone.
 */

interface ClockTimeEditorProps {
  jobId: string;
  /**
   * Edit ONE work session (awerfixes.pdf item 6, round 3). When set, the modal
   * also offers Delete — a session clocked onto the wrong job has to be
   * removable, and squashing it into a neighbour to hide it is exactly what an
   * audit trail is meant to prevent.
   */
  sessionId?: string | null;
  /** Null = edit the job-level clock fields (legacy jobs / whole job). */
  cleanerId?: string | null;
  cleanerName?: string | null;
  clockInTime: string | null;
  clockOutTime: string | null;
  /** Rendered as the trigger; defaults to a small "Edit times" link. */
  label?: string;
  /**
   * Called after a successful save, for lists that hold their own client-side
   * state (the time-tracking feed) and don't reload on router.refresh().
   */
  onSaved?: () => void;
}

function splitInstant(iso: string | null) {
  if (!iso) return { date: "", time: "" };
  const parts = tzInputParts(iso);
  // tzInputParts returns HH:MM:SS — the picker speaks HH:MM.
  return { date: parts.date, time: parts.time.slice(0, 5) };
}

export default function ClockTimeEditor({
  jobId,
  sessionId = null,
  cleanerId = null,
  cleanerName = null,
  clockInTime,
  clockOutTime,
  label = "Edit times",
  onSaved,
}: ClockTimeEditorProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const initialIn = splitInstant(clockInTime);
  const initialOut = splitInstant(clockOutTime);
  const [inDate, setInDate] = useState(initialIn.date);
  const [inTime, setInTime] = useState(initialIn.time);
  const [outDate, setOutDate] = useState(initialOut.date);
  const [outTime, setOutTime] = useState(initialOut.time);
  const [reason, setReason] = useState("");

  const openEditor = () => {
    const a = splitInstant(clockInTime);
    const b = splitInstant(clockOutTime);
    setInDate(a.date);
    setInTime(a.time);
    setOutDate(b.date);
    setOutTime(b.time);
    setReason("");
    setError(null);
    setWarning(null);
    setConfirmDelete(false);
    setOpen(true);
  };

  // A time with no date can't be placed on the calendar; a date with no time
  // is read as the start of that day, which is never a real clock-in.
  const toInstant = (date: string, time: string): string | null | "partial" => {
    if (!date && !time) return null;
    if (!date || !time) return "partial";
    return tzWallClockToUtc(date, `${time}:00`).toISOString();
  };

  const save = async () => {
    setError(null);
    setWarning(null);
    const clockIn = toInstant(inDate, inTime);
    const clockOut = toInstant(outDate, outTime);
    if (clockIn === "partial" || clockOut === "partial") {
      setError("Each time needs both a date and a time — or leave both blank.");
      return;
    }

    setSaving(true);
    const result = await updateClockTimes({
      jobId,
      sessionId,
      cleanerId,
      clockInTime: clockIn,
      clockOutTime: clockOut,
      reason,
    });
    setSaving(false);

    if (!result.success) {
      setError(result.error);
      return;
    }
    router.refresh();
    onSaved?.();
    if (result.warning) {
      // Keep the modal open so the payroll caveat is actually read.
      setWarning(result.warning);
      return;
    }
    setOpen(false);
  };

  const removeSession = async () => {
    if (!sessionId) return;
    setError(null);
    setWarning(null);
    setSaving(true);
    const result = await deleteJobWorkSession({ jobId, sessionId, reason });
    setSaving(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    router.refresh();
    onSaved?.();
    if (result.warning) {
      setWarning(result.warning);
      return;
    }
    setOpen(false);
  };

  const clearBoth = () => {
    setInDate("");
    setInTime("");
    setOutDate("");
    setOutTime("");
  };

  return (
    <>
      <button
        type="button"
        onClick={openEditor}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 12,
          fontWeight: 600,
          color: "var(--primary)",
          background: "none",
          border: 0,
          cursor: "pointer",
          padding: 0,
        }}>
        <Clock size={12} /> {label}
      </button>

      <Modal
        isOpen={open}
        onClose={() => !saving && setOpen(false)}
        title={
          sessionId
            ? `Edit ${cleanerName ? `${cleanerName}'s ` : ""}work session`
            : cleanerName
              ? `Edit ${cleanerName}'s times`
              : "Edit job clock times"
        }
        subheader={
          sessionId
            ? "Times are in the business timezone. A session needs a start time — use Delete to remove one recorded in error."
            : "Times are in the business timezone. Leave both blank to clear."
        }>
        <div style={{ padding: 24, display: "grid", gap: 20 }}>
          <div>
            <label className="label">Clock in</label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 160px" }}>
                <DatePicker value={inDate} onChange={setInDate} disabled={saving} size="md" />
              </div>
              <div style={{ flex: "1 1 130px" }}>
                <TimePicker value={inTime} onChange={setInTime} disabled={saving} size="md" step={5} />
              </div>
            </div>
          </div>

          <div>
            <label className="label">Clock out</label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 160px" }}>
                <DatePicker value={outDate} onChange={setOutDate} disabled={saving} size="md" />
              </div>
              <div style={{ flex: "1 1 130px" }}>
                <TimePicker value={outTime} onChange={setOutTime} disabled={saving} size="md" step={5} />
              </div>
            </div>
          </div>

          <div>
            <label className="label">Reason (optional)</label>
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={saving}
              placeholder="Missed clock-in, app error, corrected by phone…"
            />
            <p style={{ fontSize: 12, color: "var(--primary-60)", marginTop: 6 }}>
              The original and edited times, your name and the time of this edit
              are recorded in Job Logs.
            </p>
          </div>

          {error && (
            <div
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 10,
                padding: "10px 14px",
                fontSize: 13,
                color: "#b91c1c",
              }}>
              {error}
            </div>
          )}

          {warning && (
            <div
              style={{
                background: "#fffbeb",
                border: "1px solid #fde68a",
                borderRadius: 10,
                padding: "10px 14px",
                fontSize: 13,
                color: "#92400e",
                display: "flex",
                gap: 8,
              }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                Saved. {warning}
              </span>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            {sessionId ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => (confirmDelete ? removeSession() : setConfirmDelete(true))}
                disabled={saving}
                style={{ marginRight: "auto", color: "#b91c1c" }}>
                <Trash2 size={13} style={{ marginRight: 5, verticalAlign: -2 }} />
                {confirmDelete ? "Confirm delete" : "Delete session"}
              </button>
            ) : (
              <button type="button" className="btn btn-ghost" onClick={clearBoth} disabled={saving}>
                Clear
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setOpen(false)}
              disabled={saving}>
              {warning ? "Done" : "Cancel"}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={save}
              disabled={saving}
              style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {saving ? <><Loader size={14} className="animate-spin" /> Saving…</> : "Save times"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
