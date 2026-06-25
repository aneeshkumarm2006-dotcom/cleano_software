"use client";

import { useState } from "react";
import { Banner, Button, Field, Textarea } from "@/components/customer/Field";
import CustomerModal from "@/components/customer/Modal";
import DatePicker from "@/components/customer/DatePicker";
import { requestCancellation } from "../../../actions/requestCancellation";
import { requestReschedule } from "../../../actions/requestReschedule";

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function RequestActions({
  jobId,
  startTime,
  cancellationFeeUsd,
  cancellationWindowHours,
  cancellationReasons,
}: {
  jobId: string;
  startTime: string;
  cancellationFeeUsd: number;
  cancellationWindowHours: number;
  cancellationReasons: string[];
}) {
  const withinFeeWindow =
    new Date(startTime).getTime() - Date.now() <
    cancellationWindowHours * 60 * 60 * 1000;
  const feeLabel = `$${cancellationFeeUsd.toFixed(0)}`;
  const [busy, setBusy] = useState<"cancel" | "reschedule" | null>(null);
  const [msg, setMsg] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  // Cancel modal
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  // Reschedule modal
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [preferredDate, setPreferredDate] = useState("");
  const [rescheduleNotes, setRescheduleNotes] = useState("");

  async function submitCancel() {
    if (!cancelReason) return;
    setBusy("cancel");
    const res = await requestCancellation(jobId, cancelReason);
    setBusy(null);
    setCancelOpen(false);
    setCancelReason("");
    setMsg(
      res.success
        ? {
            kind: "success",
            text: res.feeCharged
              ? `Cancellation requested — a $${res.feeUsd?.toFixed(0)} late-cancellation fee was charged to your card. Awaiting confirmation.`
              : "Cancellation requested — awaiting confirmation.",
          }
        : { kind: "error", text: res.error || "Failed" }
    );
  }

  async function submitReschedule() {
    if (!preferredDate) {
      setMsg({
        kind: "error",
        text: "Please choose a new date for your booking.",
      });
      return;
    }
    setBusy("reschedule");
    const notesParts: string[] = [];
    if (preferredDate) notesParts.push(`Preferred: ${preferredDate}`);
    if (rescheduleNotes.trim()) notesParts.push(rescheduleNotes.trim());
    const res = await requestReschedule({
      jobId,
      preferredDate: preferredDate || undefined,
      notes: notesParts.join(" — "),
    });
    setBusy(null);
    setRescheduleOpen(false);
    setPreferredDate("");
    setRescheduleNotes("");
    setMsg(
      res.success
        ? { kind: "success", text: "Reschedule requested — we'll be in touch." }
        : { kind: "error", text: res.error || "Failed" }
    );
  }

  return (
    <>
      <section className="cl-tile cl-tile-pad-lg">
        <h2 className="cl-title-md" style={{ marginBottom: 14 }}>
          Need to change this?
        </h2>
        {msg ? (
          <div style={{ marginBottom: 12 }}>
            <Banner kind={msg.kind}>{msg.text}</Banner>
          </div>
        ) : null}
        <div className="cl-stack-8">
          <Button
            variant="secondary"
            block
            onClick={() => setRescheduleOpen(true)}
            disabled={busy !== null}>
            Request reschedule
          </Button>
          <Button
            variant="dangerGhost"
            block
            onClick={() => setCancelOpen(true)}
            disabled={busy !== null}>
            Request cancellation
          </Button>
        </div>
        <p
          style={{
            fontSize: 11,
            color: "var(--primary-50)",
            margin: "12px 0 0",
            lineHeight: 1.5,
          }}>
          Requests are reviewed by our team — your booking won&rsquo;t be
          changed automatically.
        </p>
      </section>

      <CustomerModal
        open={rescheduleOpen}
        onClose={() => setRescheduleOpen(false)}
        title="Request a reschedule"
        description="Tell us when you'd like to move this booking to. Our team will reach out to confirm.">
        <div className="cl-stack-16">
          <Field label="Preferred new date">
            <DatePicker
              value={preferredDate}
              onChange={setPreferredDate}
              min={tomorrowISO()}
              placeholder="Choose a date"
            />
          </Field>
          <Field label="Notes (optional)" htmlFor="rs-notes">
            <Textarea
              id="rs-notes"
              rows={3}
              value={rescheduleNotes}
              onChange={(e) => setRescheduleNotes(e.target.value)}
              placeholder="Any preferred times, reasons, or constraints…"
            />
          </Field>
          <div className="cl-modal-actions">
            <Button
              variant="ghost"
              onClick={() => setRescheduleOpen(false)}
              disabled={busy !== null}>
              Cancel
            </Button>
            <Button
              onClick={submitReschedule}
              loading={busy === "reschedule"}
              disabled={busy !== null || !preferredDate}>
              Submit request
            </Button>
          </div>
        </div>
      </CustomerModal>

      <CustomerModal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this booking?"
        description="Our team reviews every cancellation and will reach out to confirm. Your booking won't be cancelled automatically.">
        <div className="cl-stack-16">
          <Banner kind={withinFeeWindow ? "error" : "amber"}>
            {withinFeeWindow
              ? `Heads up: this booking is within ${cancellationWindowHours} hours, so a ${feeLabel} cancellation fee will apply.`
              : `Cancellations within ${cancellationWindowHours} hours of your appointment are charged a ${feeLabel} fee.`}
          </Banner>
          <Field label="Reason for cancelling" htmlFor="cn-reason">
            <select
              id="cn-reason"
              className="cl-input"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}>
              <option value="" disabled>
                Select a reason…
              </option>
              {cancellationReasons.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <div className="cl-modal-actions">
            <Button
              variant="ghost"
              onClick={() => setCancelOpen(false)}
              disabled={busy !== null}>
              Keep booking
            </Button>
            <Button
              variant="amber"
              onClick={submitCancel}
              loading={busy === "cancel"}
              disabled={busy !== null || !cancelReason}>
              Request cancellation
            </Button>
          </div>
        </div>
      </CustomerModal>
    </>
  );
}
