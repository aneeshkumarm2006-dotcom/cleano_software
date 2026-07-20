"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, X } from "lucide-react";
import { Banner, Button, Field, Textarea } from "@/components/customer/Field";
import { StatusBadge, DateBadge } from "@/components/customer/atoms";
import CustomerModal from "@/components/customer/Modal";
import DatePicker from "@/components/customer/DatePicker";
import { requestCancellation } from "../../actions/requestCancellation";
import { requestReschedule } from "../../actions/requestReschedule";

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

interface Booking {
  id: string;
  jobNumber: number;
  startTime: string;
  status: string;
  isFlexible: boolean;
  location: string | null;
  jobType: string | null;
  price: number | null;
  paidAt: string | null;
  paymentReceived: boolean;
  refundedAmount: number;
  depositPaid: boolean;
  depositPaidAt: string | null;
  cancellationRequestedAt: string | null;
  rescheduleRequestedAt: string | null;
  cleaners: { id: string; name: string }[];
  addOns: { name: string; price: number }[];
  parentJobId: string | null;
  seriesSize: number;
}

function formatPrice(n: number | null | undefined) {
  return `$${(n ?? 0).toFixed(2)}`;
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Toronto",
  });
}

export default function BookingsClient({ bookings }: { bookings: Booking[] }) {
  const router = useRouter();
  const [flash, setFlash] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Cancel modal state
  const [cancelJobId, setCancelJobId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  // Reschedule modal state
  const [rescheduleJobId, setRescheduleJobId] = useState<string | null>(null);
  const [preferredDate, setPreferredDate] = useState("");
  const [rescheduleNotes, setRescheduleNotes] = useState("");

  function openBooking(id: string) {
    router.push(`/bookings/${id}`);
  }

  function handleCancel(jobId: string) {
    setCancelJobId(jobId);
    setCancelReason("");
  }
  function handleReschedule(jobId: string) {
    setRescheduleJobId(jobId);
    setPreferredDate("");
    setRescheduleNotes("");
  }

  async function submitCancel() {
    if (!cancelJobId) return;
    setBusyId(cancelJobId);
    const res = await requestCancellation(cancelJobId);
    setBusyId(null);
    setCancelJobId(null);
    setFlash(
      res.success
        ? { kind: "success", text: "Cancellation requested — awaiting confirmation." }
        : { kind: "error", text: res.error || "Failed" }
    );
  }

  async function submitReschedule() {
    if (!rescheduleJobId) return;
    if (!preferredDate && !rescheduleNotes.trim()) {
      setFlash({
        kind: "error",
        text: "Please pick a date or add a note for our team.",
      });
      return;
    }
    setBusyId(rescheduleJobId);
    const notesParts: string[] = [];
    if (preferredDate) notesParts.push(`Preferred: ${preferredDate}`);
    if (rescheduleNotes.trim()) notesParts.push(rescheduleNotes.trim());
    const res = await requestReschedule({
      jobId: rescheduleJobId,
      preferredDate: preferredDate || undefined,
      notes: notesParts.join(" — "),
    });
    setBusyId(null);
    setRescheduleJobId(null);
    setFlash(
      res.success
        ? { kind: "success", text: "Reschedule requested — we'll be in touch." }
        : { kind: "error", text: res.error || "Failed" }
    );
  }

  const now = new Date();
  const upcoming = bookings.filter(
    (b) => new Date(b.startTime) >= now && b.status !== "CANCELLED"
  );
  const past = bookings.filter(
    (b) => new Date(b.startTime) < now && b.status !== "CANCELLED"
  );
  const cancelled = bookings.filter((b) => b.status === "CANCELLED");

  type Tab = "upcoming" | "past" | "cancelled";
  const [tab, setTab] = useState<Tab>("upcoming");
  const tabs: { id: Tab; label: string; count: number; empty: string }[] = [
    { id: "upcoming", label: "Upcoming", count: upcoming.length, empty: "No upcoming bookings." },
    { id: "past", label: "Past", count: past.length, empty: "No past bookings yet." },
    { id: "cancelled", label: "Cancelled", count: cancelled.length, empty: "No cancelled bookings." },
  ];
  const list = tab === "upcoming" ? upcoming : tab === "past" ? past : cancelled;
  const isPast = tab !== "upcoming";

  return (
    <>
      <header className="cl-row-between" style={{ marginBottom: 36, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="cl-stack-8">
          <p className="cl-eyebrow">Your bookings</p>
          <h1 className="cl-display" style={{ fontSize: "clamp(34px, 4.2vw, 48px)" }}>All cleanings.</h1>
        </div>
        <Link href="/book" className="cl-btn cl-btn-primary">+ New booking</Link>
      </header>

      {flash ? (
        <div style={{ marginBottom: 24 }}>
          <Banner kind={flash.kind}>
            <div className="cl-row-between">
              <span>{flash.text}</span>
              <button
                className="cl-icon-btn"
                style={{ width: 24, height: 24 }}
                aria-label="Dismiss"
                onClick={() => setFlash(null)}>
                <X size={14} />
              </button>
            </div>
          </Banner>
        </div>
      ) : null}

      <div
        role="tablist"
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          padding: 4,
          marginBottom: 20,
          background: "var(--primary-5)",
          borderRadius: 14,
          width: "fit-content",
          maxWidth: "100%",
        }}>
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 14px",
                borderRadius: 10,
                border: 0,
                cursor: "pointer",
                fontSize: 13.5,
                fontWeight: active ? 600 : 500,
                fontFamily: "inherit",
                color: active ? "#fff" : "var(--primary)",
                background: active ? "var(--primary)" : "transparent",
                transition: "background .15s, color .15s",
              }}>
              <span>{t.label}</span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "1px 7px",
                  borderRadius: 999,
                  background: active ? "rgba(255,255,255,0.18)" : "var(--primary-10)",
                  color: active ? "#fff" : "var(--primary-70)",
                }}>
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      <section className="cl-stack-12">
        {list.length === 0 ? (
          <div className="cl-tile cl-tile-pad-sm" style={{ color: "var(--primary-60)", fontSize: 14, textAlign: "center", padding: 24 }}>
            {tabs.find((t) => t.id === tab)?.empty}
          </div>
        ) : (
          list.map((b) => (
            <BookingCard
              key={b.id}
              b={b}
              past={isPast}
              busy={busyId === b.id}
              onReschedule={tab === "upcoming" ? () => handleReschedule(b.id) : undefined}
              onCancel={tab === "upcoming" ? () => handleCancel(b.id) : undefined}
              onOpen={() => openBooking(b.id)}
            />
          ))
        )}
      </section>

      <CustomerModal
        open={rescheduleJobId !== null}
        onClose={() => setRescheduleJobId(null)}
        title="Request a reschedule"
        description="Tell us when you'd like to move this booking to. Our team will reach out to confirm.">
        <div className="cl-stack-16">
          <Field label="Preferred new date (optional)">
            <DatePicker
              value={preferredDate}
              onChange={setPreferredDate}
              min={tomorrowISO()}
              placeholder="Choose a date"
            />
          </Field>
          <Field label="Notes (optional)" htmlFor="bk-rs-notes">
            <Textarea
              id="bk-rs-notes"
              rows={3}
              value={rescheduleNotes}
              onChange={(e) => setRescheduleNotes(e.target.value)}
              placeholder="Any preferred times, reasons, or constraints…"
            />
          </Field>
          <div className="cl-modal-actions">
            <Button
              variant="ghost"
              onClick={() => setRescheduleJobId(null)}
              disabled={busyId !== null}>
              Cancel
            </Button>
            <Button
              onClick={submitReschedule}
              loading={busyId === rescheduleJobId}
              disabled={busyId !== null}>
              Submit request
            </Button>
          </div>
        </div>
      </CustomerModal>

      <CustomerModal
        open={cancelJobId !== null}
        onClose={() => setCancelJobId(null)}
        title="Cancel this booking?"
        description="Our team reviews every cancellation and will reach out to confirm. Your booking won't be cancelled automatically.">
        <div className="cl-stack-16">
          <Field label="Reason (optional)" htmlFor="bk-cn-reason">
            <Textarea
              id="bk-cn-reason"
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Help us improve — why are you cancelling?"
            />
          </Field>
          <div className="cl-modal-actions">
            <Button
              variant="ghost"
              onClick={() => setCancelJobId(null)}
              disabled={busyId !== null}>
              Keep booking
            </Button>
            <Button
              variant="amber"
              onClick={submitCancel}
              loading={busyId === cancelJobId}
              disabled={busyId !== null}>
              Request cancellation
            </Button>
          </div>
        </div>
      </CustomerModal>
    </>
  );
}

function BookingCard({
  b,
  past,
  busy,
  onReschedule,
  onCancel,
  onOpen,
}: {
  b: Booking;
  past?: boolean;
  busy?: boolean;
  onReschedule?: () => void;
  onCancel?: () => void;
  onOpen?: () => void;
}) {
  const hasRequest = b.cancellationRequestedAt || b.rescheduleRequestedAt;
  const isCompletedOrPaid = b.status === "COMPLETED" || b.status === "PAID";

  function stopProp(e: React.MouseEvent) {
    e.stopPropagation();
  }

  return (
    <article
      className="cl-bcard"
      onClick={onOpen}
      style={{ cursor: onOpen ? "pointer" : "default" }}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={(e) => {
        if (onOpen && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}>
      <div className="cl-bcard-top">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 18, minWidth: 0, flex: 1 }}>
          <DateBadge iso={b.startTime} />
          <div className="cl-stack-4" style={{ minWidth: 0 }}>
            <span className="cl-bcard-id">Job #{b.jobNumber}</span>
            <h3 className="cl-bcard-date">
              {formatTime(b.startTime)}
              {b.isFlexible ? (
                <span style={{ fontSize: 13, fontWeight: 400, color: "var(--primary-50)", marginLeft: 8 }}>(flexible)</span>
              ) : null}
            </h3>
            {b.location ? <div style={{ fontSize: 13, color: "var(--primary-60)" }}>{b.location}</div> : null}
          </div>
        </div>
        <StatusBadge status={b.status} />
      </div>

      <div className="cl-bcard-meta">
        {b.jobType ? <span style={{ fontWeight: 500, color: "var(--ink)" }}>{b.jobType}</span> : null}
        {b.cleaners.length ? <span>· with {b.cleaners.map((c) => c.name).join(", ")}</span> : null}
        {b.seriesSize > 1 ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "3px 8px",
              borderRadius: 999,
              background: "var(--primary-5)",
              color: "var(--primary)",
              letterSpacing: "0.04em",
            }}
            title="Part of a recurring booking">
            ⟳ {b.parentJobId ? `Part of ${b.seriesSize}-visit series` : `Recurring · ${b.seriesSize} visits`}
          </span>
        ) : null}
        <span className="cl-bcard-price">{formatPrice(b.price)}</span>
        {b.depositPaid ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "3px 8px",
              borderRadius: 999,
              background: "rgba(5,150,105,0.12)",
              color: "#047857",
              letterSpacing: "0.04em",
            }}
            title="A $20 deposit was charged at booking.">
            $20 deposit collected
          </span>
        ) : null}
      </div>

      {b.addOns.length ? (
        <div style={{ fontSize: 12, color: "var(--primary-50)" }}>
          Add-ons: {b.addOns.map((a) => a.name).join(", ")}
        </div>
      ) : null}

      {hasRequest ? (
        <Banner kind="amber">
          {b.cancellationRequestedAt
            ? "Cancellation requested — awaiting confirmation."
            : "Reschedule requested — we'll be in touch."}
        </Banner>
      ) : null}

      {past && isCompletedOrPaid ? (
        <div className="cl-bcard-foot" onClick={stopProp}>
          <a
            className="cl-link"
            style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}
            href={`/api/receipts/${b.id}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={stopProp}>
            <Download size={14} /> Download receipt
          </a>
          {b.refundedAmount > 0 ? (
            <span style={{ fontSize: 12, color: "var(--amber-700)", fontWeight: 600, marginLeft: "auto" }}>
              Refund: {formatPrice(b.refundedAmount)}
            </span>
          ) : null}
        </div>
      ) : null}

      {!past && !hasRequest ? (
        <div className="cl-bcard-foot" onClick={stopProp}>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onReschedule?.();
            }}
            disabled={busy}>
            Request reschedule
          </Button>
          <Button
            variant="dangerGhost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onCancel?.();
            }}
            disabled={busy}>
            Request cancellation
          </Button>
        </div>
      ) : null}
    </article>
  );
}
