"use client";

import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useCalendar } from "./CalendarContext";
import Textarea from "@/components/ui/Textarea";
import JobModal, {
  type ClientLite,
  type User as JobModalUser,
  type AddOnCatalogItem,
} from "@/app/admin/jobs/JobModal";
import type { TaxRates } from "@/lib/tax";
import { ADDON_INCLUDED_LABEL, addOnAmountIsIncluded } from "@/lib/job-money";
import { formatDeposit, resolveDepositCredit } from "@/lib/booking-deposit";
import { formatHours } from "@/lib/hourly-billing";
import { propertyTypeLabel } from "@/lib/property-type";
import { formatAddressLine } from "@/lib/client-address";
import { storeInputParts, storeWallClockToUtc } from "@/lib/timezone";
import { avatarColor, initials } from "@/lib/avatar";
import { statusMeta } from "./status-meta";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Copy,
  CreditCard,
  ExternalLink,
  HelpCircle,
  Image as ImageIcon,
  LogIn,
  Mail,
  MapPin,
  Pencil,
  Phone,
  PlayCircle,
  Receipt,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { markArrived } from "@/app/admin/actions/markArrived";
import { releaseJobHold } from "@/app/admin/actions/releaseJobHold";
import { HOLD_LABEL, holdReasonText, ON_HOLD_STATUS } from "@/lib/job-hold";
import { isAwaitingQuote } from "@/lib/quote-status";
import { addJobNote } from "@/app/admin/actions/addJobNote";
import { getJobSummary } from "@/app/admin/actions/getJobSummary";
import type { JobSummaryDTO } from "@/app/admin/actions/getJobSummary.types";
import { cancelJobByAdmin } from "@/app/admin/actions/cancelJobByAdmin";
import { resendReceipt } from "@/app/admin/actions/resendReceipt";
import { togglePaymentReceived } from "@/app/admin/actions/toggleJobPaymentStatus";
import { chargeJob } from "@/app/admin/actions/chargeJob";
import { getJobPhotos } from "@/app/admin/actions/getJobPhotos";
import type { JobPhotoDTO } from "@/app/admin/actions/getJobPhotos.types";
import { jobPhotoKindLabel } from "@/lib/job-photos";
import { saveJob } from "@/app/admin/actions/saveJob";

const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${Number(n).toFixed(2)}`;

/** Same wording as the job detail page's `payTypeLabel`. */
const PAYMENT_TYPE_LABELS: Record<string, string> = {
  CASH: "Cash",
  CHEQUE: "Cheque",
  E_TRANSFER: "E-Transfer",
  CREDIT_CARD: "Card on file",
  OTHER: "Other",
};

/**
 * `JobCleanerStatus` values worth calling out beside a cleaner's name.
 * ASSIGNED is the default and says nothing, so it is deliberately absent.
 */
const ASSIGNMENT_LABELS: Record<string, string> = {
  ON_THE_WAY: "on the way",
  CLOCKED_IN: "clocked in",
  CLOCKED_OUT: "clocked out",
  COMPLETED: "done",
  CANCELLED: "cancelled",
};

type Panel = "summary" | "cancel" | "photos";

function Row({
  k,
  children,
}: {
  k: string;
  children: React.ReactNode;
}) {
  return (
    <div className="cjd-row">
      <span className="cjd-k">{k}</span>
      <span className="cjd-v">{children}</span>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="cjd-sec">
      <h4 className="cjd-sec-title">{title}</h4>
      <div className="cjd-rows">{children}</div>
    </section>
  );
}

/**
 * The calendar's booking drawer (client feedback item 8, OPEN-QUESTIONS Q2 §5–§7).
 *
 * Replaces the centred `Modal` this used to render. Two things were wrong with
 * that, and both were the client's complaint:
 *
 *  1. a centred dialog covers the grid you were just reading — hence a
 *     right-docked drawer over a light scrim, so the week stays legible behind
 *     the panel;
 *  2. every quick action was wrapped in `{isEmployee && …}` while the admin
 *     calendar passes `isEmployee={false}`, so cleaners got actions and admins
 *     got a single "Open job details" link. The admin set is now the primary
 *     one.
 *
 * The cleaner branch is kept below even though nothing currently mounts it:
 * `/admin/calendar` and `/cleaners/calendar` are the same page, and it returns
 * `CleanerCalendarClient` for role EMPLOYEE *before* this component is
 * reached. Deleting the branch would be a silent behaviour change the day that
 * routing is revisited, so it stays, gated as it always was.
 *
 * Per **D4** this is a SUMMARY, not an inline editor: Edit opens the same
 * `JobModal` the Jobs page and job detail page use, and anything deeper is one
 * click away behind "Open full job".
 */
export default function CalendarJobActions({
  isEmployee = false,
  clients = [],
  users = [],
  addOnCatalog = [],
  taxRates,
}: {
  isEmployee?: boolean;
  clients?: ClientLite[];
  users?: JobModalUser[];
  addOnCatalog?: AddOnCatalogItem[];
  taxRates?: TaxRates;
}) {
  const {
    selectedEvent,
    showEventModal,
    setShowEventModal,
    setSelectedEvent,
    refreshEvents,
  } = useCalendar();
  const router = useRouter();

  // Admins land on the admin job view; cleaners on their own job page.
  const jobBasePath = isEmployee ? "/cleaners/my-jobs" : "/admin/jobs";

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [summary, setSummary] = useState<JobSummaryDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [panel, setPanel] = useState<Panel>("summary");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteText, setNoteText] = useState("");

  const [cancelReason, setCancelReason] = useState("");
  const [refundDeposit, setRefundDeposit] = useState(false);

  const [photos, setPhotos] = useState<JobPhotoDTO[] | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const [editOpen, setEditOpen] = useState(false);

  const event = selectedEvent;
  const jobId = (event?.metadata?.jobId as string | undefined) ?? null;
  const isOpen = showEventModal && !!jobId;

  // ── Fetch on open ─────────────────────────────────────────────────────────
  // Keyed on the job id, so clicking straight from one booking to another
  // re-fetches instead of showing the previous job's money. Guarded against a
  // late response from a job the user has already navigated away from.
  useEffect(() => {
    if (!isOpen || !jobId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setSummary(null);
    getJobSummary(jobId)
      .then((res) => {
        if (cancelled) return;
        if (res.success) setSummary(res.job);
        else setLoadError(res.error);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Could not load this booking");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, jobId]);

  // Reset the per-job UI whenever a different booking is opened.
  useEffect(() => {
    setPanel("summary");
    setActionMessage(null);
    setShowNoteInput(false);
    setNoteText("");
    setCancelReason("");
    setPhotos(null);
    setLightboxIdx(null);
  }, [jobId]);

  const handleClose = useCallback(() => {
    setShowEventModal(false);
    setSelectedEvent(null);
    setPanel("summary");
    setShowNoteInput(false);
    setNoteText("");
    setActionMessage(null);
    setLightboxIdx(null);
  }, [setShowEventModal, setSelectedEvent]);

  // Escape closes the topmost layer first: lightbox → sub-panel → drawer. The
  // edit modal owns its own Escape handling, so it is skipped here.
  useEffect(() => {
    if (!isOpen || editOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (lightboxIdx !== null) setLightboxIdx(null);
      else if (panel !== "summary") setPanel("summary");
      else handleClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, editOpen, lightboxIdx, panel, handleClose]);

  /** Re-read the drawer's own payload after an action changed the job. */
  const reloadSummary = useCallback(async () => {
    if (!jobId) return;
    const res = await getJobSummary(jobId);
    if (res.success) setSummary(res.job);
  }, [jobId]);

  // ── Cleaner actions (legacy set — see the component note) ─────────────────
  const handleMarkArrived = useCallback(async () => {
    if (!jobId) return;
    setActionLoading("arrived");
    setActionMessage(null);
    try {
      const result = await markArrived(jobId);
      if (result.success) {
        setActionMessage({ type: "success", text: "Marked as arrived." });
        refreshEvents();
        setTimeout(handleClose, 1200);
      } else {
        setActionMessage({
          type: "error",
          text: result.error || "Failed to mark arrived",
        });
      }
    } catch {
      setActionMessage({ type: "error", text: "Something went wrong" });
    } finally {
      setActionLoading(null);
    }
  }, [jobId, refreshEvents, handleClose]);

  const handleAddNote = useCallback(async () => {
    if (!jobId || !noteText.trim()) return;
    setActionLoading("note");
    setActionMessage(null);
    try {
      const result = await addJobNote(jobId, noteText.trim());
      if (result.success) {
        setActionMessage({ type: "success", text: "Note added." });
        setShowNoteInput(false);
        setNoteText("");
      } else {
        setActionMessage({
          type: "error",
          text: result.error || "Failed to add note",
        });
      }
    } catch {
      setActionMessage({ type: "error", text: "Something went wrong" });
    } finally {
      setActionLoading(null);
    }
  }, [jobId, noteText]);

  // ── Admin actions ─────────────────────────────────────────────────────────
  const handleOpenFullJob = useCallback(() => {
    if (!jobId) return;
    router.push(`${jobBasePath}/${jobId}`);
    handleClose();
  }, [jobId, router, handleClose, jobBasePath]);

  const handleDuplicate = useCallback(() => {
    if (!jobId) return;
    router.push(`/admin/jobs/new?duplicate=${jobId}`);
    handleClose();
  }, [jobId, router, handleClose]);

  const handleResendReceipt = useCallback(async () => {
    if (!jobId) return;
    setActionLoading("receipt");
    setActionMessage(null);
    const res = await resendReceipt(jobId);
    setActionLoading(null);
    setActionMessage(
      res.success
        ? { type: "success", text: "Receipt re-sent." }
        : { type: "error", text: res.error || "Could not resend the receipt" }
    );
  }, [jobId]);

  const handleConfirmCancel = useCallback(async () => {
    if (!jobId) return;
    setActionLoading("cancel");
    setActionMessage(null);
    const res = await cancelJobByAdmin({
      jobId,
      refundDeposit: refundDeposit && !!summary?.depositPaid,
      reason: cancelReason.trim() || undefined,
    });
    setActionLoading(null);
    if (!res.success) {
      setActionMessage({
        type: "error",
        text: res.error || "Failed to cancel this booking",
      });
      return;
    }
    setPanel("summary");
    setActionMessage({ type: "success", text: "Booking cancelled." });
    await reloadSummary();
    refreshEvents();
  }, [jobId, refundDeposit, cancelReason, summary, reloadSummary, refreshEvents]);

  const handleMarkPaid = useCallback(async () => {
    if (!jobId) return;
    setActionLoading("paid");
    setActionMessage(null);
    const res = await togglePaymentReceived(jobId);
    setActionLoading(null);
    if (!res.success) {
      setActionMessage({
        type: "error",
        text: res.error || "Could not update payment",
      });
      return;
    }
    setActionMessage({ type: "success", text: "Marked as paid." });
    await reloadSummary();
    refreshEvents();
  }, [jobId, reloadSummary, refreshEvents]);

  /**
   * Release this booking from hold (round 4, fix 6). Same shape as the two
   * handlers around it — act, reload the summary, refresh the grid — so the
   * card repaints from amber the moment it lands.
   */
  const handleReleaseHold = useCallback(async () => {
    if (!jobId) return;
    setActionLoading("hold");
    setActionMessage(null);
    const res = await releaseJobHold(jobId);
    setActionLoading(null);
    if (!res.success) {
      setActionMessage({ type: "error", text: res.error });
      return;
    }
    setActionMessage({ type: "success", text: "Released from hold — now scheduled." });
    await reloadSummary();
    refreshEvents();
  }, [jobId, reloadSummary, refreshEvents]);

  const handleCharge = useCallback(async () => {
    if (!jobId) return;
    setActionLoading("charge");
    setActionMessage(null);
    const res = await chargeJob(jobId);
    setActionLoading(null);
    if (!res.success) {
      setActionMessage({
        type: "error",
        text: res.error || "The card could not be charged",
      });
      return;
    }
    setActionMessage({ type: "success", text: "Card charged." });
    await reloadSummary();
    refreshEvents();
  }, [jobId, reloadSummary, refreshEvents]);

  const handleViewMedia = useCallback(async () => {
    if (!jobId) return;
    setPanel("photos");
    if (photos) return;
    setActionLoading("photos");
    const res = await getJobPhotos(jobId);
    setActionLoading(null);
    if (res.success) setPhotos(res.photos);
    else {
      setPhotos([]);
      setActionMessage({
        type: "error",
        text: res.error || "Could not load photos",
      });
    }
  }, [jobId, photos]);

  const handleResolveEquipment = useCallback(() => {
    // Admin calendar → link straight to THAT cleaner's inventory (item 6), not
    // the cleaner-facing self-resolve page. Prefer an assigned cleaner; fall
    // back to the lead employee.
    const eventMeta = event?.metadata as
      | { cleaners?: { id: string }[]; employeeId?: string }
      | undefined;
    const cleanerId = eventMeta?.cleaners?.[0]?.id || eventMeta?.employeeId;
    if (!cleanerId) return;
    router.push(`/admin/employees/${cleanerId}?tab=products`);
    handleClose();
  }, [event, router, handleClose]);

  if (!mounted || !isOpen || !event) return null;

  const meta = event.metadata ?? {};
  // The status pill reads from the FETCHED job once it lands, not from the grid
  // event. `selectedEvent` is a snapshot taken at click time and is never
  // rewritten, so cancelling or charging from in here would otherwise leave the
  // header contradicting the payment block directly beneath it. Routed through
  // the shared `statusMeta` so the pill keeps the calendar's palette.
  const sm = summary
    ? statusMeta({
        ...event,
        metadata: {
          ...meta,
          status: summary.status,
          paymentReceived: summary.paymentReceived,
          cleaners: summary.cleaners,
        },
      })
    : statusMeta(event);
  const status = (summary?.status ?? meta.status) as string | undefined;
  const cancelled = status === "CANCELLED";
  const completed = status === "COMPLETED" || status === "PAID";
  // Round 4, fix 6. `holdReason` only arrives with the summary fetch, so the
  // panel appears a beat after the drawer opens — the reason is the point of
  // it, and a box that says "On hold" and then fills in why reads worse than
  // one that arrives complete.
  const onHold = status === ON_HOLD_STATUS;
  const isQuoteRequest = isAwaitingQuote(summary?.quoteStatus);
  const hasMissingEquipment =
    Array.isArray(meta.missingEquipment) && meta.missingEquipment.length > 0;

  // Fall back to the grid's own metadata until the fetch lands, so the drawer
  // paints something the instant it opens instead of an empty box.
  const headline = summary?.clientName ?? event.title;
  const addressLine =
    summary?.addressLine ??
    formatAddressLine({
      address: (meta.location as string) ?? null,
      aptNumber: (meta.aptNumber as string | null) ?? null,
    });

  const paid = summary?.paymentReceived ?? !!meta.paymentReceived;
  const canCancel = !cancelled && status !== "COMPLETED";
  const showChargeButton =
    !!summary && !paid && !summary.isCashJob && summary.hasCardOnFile;

  const drawer = (
    <div className="cjd-scrim" onClick={handleClose}>
      <aside
        className="cjd admin-font"
        role="dialog"
        aria-modal="true"
        aria-label={`Booking summary — ${headline}`}
        onClick={(e) => e.stopPropagation()}>
        {/* ── Head ─────────────────────────────────────────────────────── */}
        <div className="cjd-head">
          <div className="cjd-head-pills">
            <span
              className="pill"
              style={{ background: sm.tint, color: sm.color }}>
              <span className="pill-dot" style={{ background: sm.color }} />
              {sm.label}
            </span>
            {summary?.serviceLabel ? (
              <span className="pill" style={{ background: "var(--primary-5)", color: "var(--primary)" }}>
                {summary.serviceLabel}
              </span>
            ) : null}
            {summary?.jobNumber ? (
              <span className="cjd-jobno">#{summary.jobNumber}</span>
            ) : null}
          </div>
          <button
            className="icon-btn"
            onClick={handleClose}
            aria-label="Close booking summary">
            <X size={16} />
          </button>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────── */}
        <div className="cjd-body">
          {panel === "photos" ? (
            <>
              <button
                className="cjd-back"
                onClick={() => setPanel("summary")}>
                ← Back to summary
              </button>
              <h3 className="cjd-title">Job photos</h3>
              {actionLoading === "photos" ? (
                <p className="cjd-empty">Loading photos…</p>
              ) : photos && photos.length > 0 ? (
                <div className="cjd-photos">
                  {photos.map((p, idx) => (
                    <button
                      key={p.id}
                      type="button"
                      className="cjd-photo"
                      onClick={() => setLightboxIdx(idx)}
                      /* The type is in the tooltip rather than in a badge: these
                         thumbnails are ~56px in the drawer, and a label over one
                         hides more of the photo than it explains (item 1). */
                      title={`${jobPhotoKindLabel(p.kind)} · ${
                        p.caption || `Uploaded by ${p.employeeName}`
                      }`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={p.caption || "Job photo"} />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="cjd-empty">No photos on this job yet.</p>
              )}
            </>
          ) : panel === "cancel" ? (
            <>
              <button
                className="cjd-back"
                onClick={() => setPanel("summary")}>
                ← Back to summary
              </button>
              <h3 className="cjd-title">Cancel this booking?</h3>
              <p className="cjd-note">
                {headline} · {summary?.dateLabel ?? ""}{" "}
                {summary?.timeLabel ?? ""}. The customer and every assigned
                cleaner are notified, unless notifications are muted on this
                booking.
              </p>
              <div className="field" style={{ marginTop: 4 }}>
                <label className="label" htmlFor="cjd-cancel-reason">
                  Reason (optional)
                </label>
                <Textarea
                  id="cjd-cancel-reason"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Shown to the customer in the cancellation email."
                  className="w-full"
                />
              </div>
              {summary?.depositPaid ? (
                <label className="cjd-check">
                  <input
                    type="checkbox"
                    checked={refundDeposit}
                    onChange={(e) => setRefundDeposit(e.target.checked)}
                  />
                  Refund the{" "}
                  {formatDeposit(
                    resolveDepositCredit({
                      depositPaid: true,
                      depositAmount: summary.depositAmount,
                    })
                  )}{" "}
                  deposit
                </label>
              ) : null}
            </>
          ) : (
            <>
              {/* Identity */}
              <h3 className="cjd-title">{headline}</h3>
              <div className="cjd-contact">
                {summary?.clientEmail ? (
                  <a className="cjd-contact-row" href={`mailto:${summary.clientEmail}`}>
                    <Mail size={13} />
                    {summary.clientEmail}
                  </a>
                ) : null}
                {summary?.clientPhone ? (
                  <a className="cjd-contact-row" href={`tel:${summary.clientPhone}`}>
                    <Phone size={13} />
                    {summary.clientPhone}
                  </a>
                ) : null}
                {addressLine ? (
                  <span className="cjd-contact-row">
                    <MapPin size={13} />
                    {addressLine}
                  </span>
                ) : null}
                {summary && !summary.clientId ? (
                  // The Stage-4 orphan: a booking with no customer record can't
                  // be sent a receipt, a cancellation or a rating request, so
                  // say so here rather than let the blank contact rows read as
                  // "this customer has no e-mail".
                  <span className="cjd-contact-row cjd-warn">
                    <AlertTriangle size={13} />
                    No customer record linked — this booking can&apos;t be
                    e-mailed.
                  </span>
                ) : null}
              </div>

              {loadError ? (
                <div className="cjd-msg error">{loadError}</div>
              ) : null}

              {/* Booking details */}
              <Section title="Booking details">
                <Row k="Date">
                  {summary?.dateLabel ?? "—"}
                </Row>
                <Row k="Time">
                  {summary?.timeLabel ?? "—"}
                  {summary?.durationLabel ? (
                    <span className="cjd-dim"> · {summary.durationLabel}</span>
                  ) : null}
                </Row>
                <Row k="Service">{summary?.serviceLabel ?? "—"}</Row>
                <Row k="Frequency">{summary?.frequencyLabel ?? "—"}</Row>
                <Row k="Professionals">
                  {summary
                    ? `${summary.cleaners.length} of ${summary.requiredCleaners} assigned`
                    : "—"}
                </Row>
                {summary?.postalCode ? (
                  <Row k="Postal code">{summary.postalCode}</Row>
                ) : null}
                {summary &&
                (summary.bedCount != null ||
                  summary.bathCount != null ||
                  summary.squareFootage != null ||
                  // Stage 9 — a job whose only recorded property fact is that
                  // it's a house still deserves the row.
                  propertyTypeLabel(summary.propertyType) != null) ? (
                  <Row k="Property">
                    {[
                      propertyTypeLabel(summary.propertyType),
                      summary.bedCount != null ? `${summary.bedCount} bed` : null,
                      summary.bathCount != null ? `${summary.bathCount} bath` : null,
                      summary.halfBathCount
                        ? `${summary.halfBathCount} half-bath`
                        : null,
                      summary.squareFootage
                        ? `${summary.squareFootage} sqft`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Row>
                ) : null}
                <Row k="Assigned to">
                  {summary && summary.cleaners.length > 0 ? (
                    <span className="cjd-crew">
                      {summary.cleaners.map((c) => (
                        <span className="cjd-crew-item" key={c.id}>
                          <span
                            className="cjd-crew-dot"
                            style={{ background: avatarColor(c.name) }}>
                            {initials(c.name)}
                          </span>
                          {c.name}
                          {c.status && ASSIGNMENT_LABELS[c.status] ? (
                            <span className="cjd-dim">
                              {" "}
                              · {ASSIGNMENT_LABELS[c.status]}
                            </span>
                          ) : null}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="cjd-warn">Unassigned</span>
                  )}
                </Row>
              </Section>

              {/* Money */}
              <Section title="Payment">
                <Row k="Status">
                  {paid ? (
                    <span className="pill pill-emerald">
                      {summary?.paidAtLabel ?? "Paid"}
                    </span>
                  ) : cancelled ? (
                    <span className="pill pill-rose">Cancelled</span>
                  ) : (
                    <span className="pill pill-amber">Unpaid</span>
                  )}
                </Row>
                <Row k="Method">
                  {summary
                    ? summary.isCashJob
                      ? "Cash"
                      : summary.paymentType
                      ? PAYMENT_TYPE_LABELS[summary.paymentType] ??
                        summary.paymentType
                      : summary.hasCardOnFile
                      ? "Card on file"
                      : "Not set"
                    : "—"}
                </Row>
                {summary ? (
                  <>
                    {/* Hourly jobs say so, and say what they were worked out
                        from — otherwise the Service figure is a number with no
                        visible origin (Stage 8 / PDF #8, step 8.7). */}
                    {summary.billingType === "HOURLY" ? (
                      <Row k="Billing">
                        Hourly · {money(summary.billedHourlyRate)}/h ×{" "}
                        {formatHours(
                          summary.billedActualHours ??
                            summary.billedEstimatedHours ??
                            0
                        )}
                        <span className="cjd-dim">
                          {" "}
                          {summary.billedActualHours != null
                            ? "(actual)"
                            : "(estimate)"}
                        </span>
                      </Row>
                    ) : null}
                    <Row k="Service">{money(summary.money.basePrice)}</Row>
                    {summary.money.addOnLines.map((line, i) => (
                      <Row
                        key={`${line.name}-${i}`}
                        k={
                          line.quantity > 1
                            ? `${line.name} ×${line.quantity}`
                            : line.name
                        }>
                        {addOnAmountIsIncluded(
                          line.lineTotal,
                          summary.money.addOnsIncludedInSubtotal
                        ) ? (
                          // Imported add-ons are priced $0 because the source
                          // total already covered them — say that, rather than
                          // print "$0.00 · included" (item 22).
                          <span className="cjd-dim">{ADDON_INCLUDED_LABEL}</span>
                        ) : summary.money.addOnsIncludedInSubtotal ? (
                          <span className="cjd-dim">
                            {money(line.lineTotal)} · included
                          </span>
                        ) : (
                          money(line.lineTotal)
                        )}
                      </Row>
                    ))}
                    {summary.transportation ? (
                      <Row k="Transportation">{money(summary.transportation)}</Row>
                    ) : null}
                    {summary.money.discountRecorded > 0 ? (
                      <Row k="Discount">
                        −{money(summary.money.discountRecorded)}
                      </Row>
                    ) : null}
                    {summary.money.exempt ? null : (
                      <Row k="GST + QST">
                        {money(
                          summary.money.gstAmount + summary.money.qstAmount
                        )}
                      </Row>
                    )}
                    <Row k="Total">
                      <strong>{money(summary.money.totalAmount)}</strong>
                      {summary.money.exempt ? (
                        <span className="cjd-dim"> · tax exempt</span>
                      ) : null}
                    </Row>
                    {summary.refundedAmount > 0 ? (
                      <Row k="Refunded">−{money(summary.refundedAmount)}</Row>
                    ) : null}
                    {summary.tipAmount > 0 || summary.totalTip ? (
                      <Row k="Tip">
                        {money(summary.tipAmount || summary.totalTip)}
                      </Row>
                    ) : null}
                  </>
                ) : (
                  <Row k="Total">{loading ? "Loading…" : "—"}</Row>
                )}
              </Section>

              {/* Cleaner pay — per provider, the way BookingKoala shows it. */}
              {summary && summary.cleaners.length > 0 ? (
                <Section title="Cleaner pay">
                  {summary.cleaners.map((c) => (
                    <Row key={c.id} k={c.name}>
                      {c.pay != null
                        ? money(c.pay)
                        : summary.employeePay != null
                        ? `${money(summary.employeePay)} (job total)`
                        : "—"}
                    </Row>
                  ))}
                  {summary.payType && summary.payType !== "PERCENTAGE" ? (
                    <Row k="Pay model">
                      {summary.payType === "HOURLY"
                        ? `Hourly · ${money(summary.hourlyRate)}/h`
                        : "Flat rate"}
                    </Row>
                  ) : null}
                </Section>
              ) : null}

              {/* Notes */}
              {summary?.notes || summary?.description ? (
                <Section title="Notes">
                  {summary.description ? (
                    <Row k="Description">{summary.description}</Row>
                  ) : null}
                  {summary.notes ? <Row k="Notes">{summary.notes}</Row> : null}
                </Section>
              ) : null}

              {summary?.cancellationReason ? (
                <Section title="Cancellation">
                  <Row k="Reason">{summary.cancellationReason}</Row>
                </Section>
              ) : null}

              {/* Equipment warning */}
              {hasMissingEquipment ? (
                <div className="cjd-msg warn">
                  <AlertTriangle size={14} />
                  <span>
                    {(meta.missingEquipment as unknown[]).length} item
                    {(meta.missingEquipment as unknown[]).length > 1 ? "s" : ""}{" "}
                    missing from the cleaner&apos;s kit.{" "}
                    <button className="cjd-inline-link" onClick={handleResolveEquipment}>
                      View inventory
                    </button>
                  </span>
                </div>
              ) : null}

              {/* Cleaner note composer (legacy set) */}
              {showNoteInput ? (
                <div className="field" style={{ marginTop: 4 }}>
                  <Textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Add a note about this job…"
                    className="w-full"
                  />
                  <div className="cjd-actions" style={{ justifyContent: "flex-end" }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setShowNoteInput(false);
                        setNoteText("");
                      }}>
                      Cancel
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={handleAddNote}
                      disabled={!noteText.trim() || actionLoading === "note"}>
                      {actionLoading === "note" ? "Saving…" : "Save note"}
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}

          {actionMessage ? (
            <div
              className={`cjd-msg ${
                actionMessage.type === "success" ? "ok" : "error"
              }`}>
              {actionMessage.text}
            </div>
          ) : null}
        </div>

        {/* ── Foot ─────────────────────────────────────────────────────── */}
        <div className="cjd-foot">
          {panel === "cancel" ? (
            <div className="cjd-actions">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setPanel("summary")}
                disabled={actionLoading === "cancel"}>
                Keep booking
              </button>
              <button
                className="btn btn-sm cjd-danger"
                onClick={handleConfirmCancel}
                disabled={actionLoading === "cancel"}>
                {actionLoading === "cancel" ? "Cancelling…" : "Cancel booking"}
              </button>
            </div>
          ) : isEmployee ? (
            // ── Cleaner set (unchanged behaviour) ──────────────────────────
            <div className="cjd-actions grid">
              {(status === "SCHEDULED" || status === "CREATED") && (
                <>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleMarkArrived}
                    disabled={actionLoading === "arrived"}>
                    <LogIn size={14} />
                    {actionLoading === "arrived" ? "Saving…" : "Mark arrived"}
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      router.push("/admin/chat");
                      handleClose();
                    }}>
                    <HelpCircle size={14} /> Get help
                  </button>
                </>
              )}
              {status === "IN_PROGRESS" && (
                <>
                  <button className="btn btn-primary btn-sm" onClick={handleOpenFullJob}>
                    <CheckCircle2 size={14} /> Complete job
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      if (!jobId) return;
                      router.push(`${jobBasePath}/${jobId}#photos`);
                      handleClose();
                    }}>
                    <Camera size={14} /> Upload photos
                  </button>
                </>
              )}
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowNoteInput(true)}
                disabled={showNoteInput}>
                <StickyNote size={14} /> Add note
              </button>
              <button className="btn btn-ghost btn-sm" onClick={handleOpenFullJob}>
                <ExternalLink size={14} /> Full job details
              </button>
            </div>
          ) : (
            // ── Admin set (Q2 §6 — every one of these already existed on the
            //    job detail page; this is the surfacing) ────────────────────
            <>
              {/* On hold (round 4, fix 6). Sits at the TOP of the admin action
                  set, above the payment line, because a held booking has not
                  been agreed yet — charging a card for it is not the next
                  thing anyone should be doing. A quote's hold points at the
                  full job page instead: `releaseJobHold` refuses those, and
                  the deposit decision that goes with them lives there.
                  (Round 4, Stage 6: this block was written second and rendered
                  second, so the drawer read "$195.46 due · Mark paid" and only
                  then "On hold". The order above is the whole argument for the
                  block existing; the click-through on job #2273 is what caught
                  the comment and the JSX disagreeing.) */}
              {onHold && summary ? (
                <div className="cjd-payline" style={{ alignItems: "flex-start", gap: 8 }}>
                  <span style={{ color: "var(--amber-800)" }}>
                    <strong>{HOLD_LABEL}</strong>
                    <br />
                    <span style={{ fontSize: 12 }}>{holdReasonText(summary.holdReason)}</span>
                  </span>
                  {isQuoteRequest ? null : (
                    <span className="cjd-actions">
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={handleReleaseHold}
                        disabled={actionLoading === "hold"}>
                        <PlayCircle size={14} />
                        {actionLoading === "hold" ? "Releasing…" : "Release"}
                      </button>
                    </span>
                  )}
                </div>
              ) : null}

              {!paid && !cancelled && summary ? (
                <div className="cjd-payline">
                  <span>
                    {/* What the Charge card button beside this will actually
                        take (fix 3 item 3.2) — the total less any deposit
                        already collected, not the gross booking value. */}
                    <strong>{money(summary.amountDue)}</strong> due
                  </span>
                  <span className="cjd-actions">
                    {showChargeButton ? (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={handleCharge}
                        disabled={actionLoading === "charge"}>
                        <CreditCard size={14} />
                        {actionLoading === "charge" ? "Charging…" : "Charge card"}
                      </button>
                    ) : null}
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={handleMarkPaid}
                      disabled={actionLoading === "paid"}>
                      {actionLoading === "paid" ? "Saving…" : "Mark paid"}
                    </button>
                  </span>
                </div>
              ) : null}

              {/* Gated on the fetch, not just on Edit: every one of these
                  server actions is OWNER/ADMIN-guarded on its own, and the
                  summary read has the same gate — so if it came back empty or
                  unauthorized, offering the buttons would only be offering
                  failures. "Open full job" below always stands. */}
              {summary ? (
                <div className="cjd-actions grid">
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setEditOpen(true)}>
                    <Pencil size={14} /> Edit
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={handleDuplicate}>
                    <Copy size={14} /> Duplicate
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={handleResendReceipt}
                    disabled={actionLoading === "receipt"}>
                    <Receipt size={14} />
                    {actionLoading === "receipt" ? "Sending…" : "Resend receipt"}
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={handleViewMedia}>
                    <ImageIcon size={14} /> View media
                    {summary.photoCount ? ` (${summary.photoCount})` : ""}
                  </button>
                  {canCancel ? (
                    <button
                      className="btn btn-sm cjd-danger-ghost"
                      onClick={() => {
                        setActionMessage(null);
                        setRefundDeposit(summary.depositPaid);
                        setPanel("cancel");
                      }}>
                      <Trash2 size={14} /> Cancel booking
                    </button>
                  ) : null}
                </div>
              ) : null}

              <button
                className="btn btn-primary btn-sm btn-block"
                onClick={handleOpenFullJob}>
                <ExternalLink size={14} /> Open full job
              </button>
              {completed ? (
                <p className="cjd-foot-note">
                  Refunds, invoices, the activity log and photo uploads live on
                  the full job page.
                </p>
              ) : null}
            </>
          )}
        </div>
      </aside>

      {/* Photo lightbox — same shell as the job detail page. */}
      {lightboxIdx !== null && photos && photos[lightboxIdx] ? (
        <div
          className="admin-lightbox"
          onClick={(e) => {
            e.stopPropagation();
            setLightboxIdx(null);
          }}>
          <button
            type="button"
            className="admin-lightbox-close"
            onClick={(e) => {
              e.stopPropagation();
              setLightboxIdx(null);
            }}
            aria-label="Close">
            <X size={20} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photos[lightboxIdx].url}
            alt={photos[lightboxIdx].caption || "Job photo"}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      {createPortal(drawer, document.body)}
      {/* Edit opens the SAME modal as the Jobs page and the job detail page
          (D4) — one form, so a calendar edit can't drift from a list edit. */}
      {summary ? (
        <JobModal
          isOpen={editOpen}
          onClose={() => setEditOpen(false)}
          mode="edit"
          users={users}
          clients={clients}
          addOnCatalog={addOnCatalog}
          taxRates={taxRates}
          job={{
            id: summary.id,
            clientName: summary.clientName,
            clientId: summary.clientId,
            location: summary.location,
            aptNumber: summary.aptNumber,
            postalCode: summary.postalCode,
            clientAddressId: summary.clientAddressId,
            description: summary.description,
            jobType: summary.jobType,
            jobDate: null,
            startTime: summary.startTimeIso,
            endTime: summary.endTimeIso,
            price: summary.price,
            employeePay: summary.employeePay,
            employeePayIsManual: summary.employeePayIsManual,
            payType: summary.payType,
            hourlyRate: summary.hourlyRate,
            // Without these four the modal would open an hourly-BILLED job on
            // Flat and reset it on save — the same trap `pricingMode` below
            // documents for the pricing mode (Stage 8).
            billingType: summary.billingType,
            billedHourlyRate: summary.billedHourlyRate,
            billedEstimatedHours: summary.billedEstimatedHours,
            billedActualHours: summary.billedActualHours,
            totalTip: summary.totalTip,
            parking: summary.transportation,
            notes: summary.notes,
            paymentType: summary.paymentType,
            discountAmount: summary.discountAmount,
            discountReason: summary.discountReason,
            bedCount: summary.bedCount,
            bathCount: summary.bathCount,
            halfBathCount: summary.halfBathCount,
            squareFootage: summary.squareFootage,
            // Without this the modal would open every job on "Not specified"
            // and clear the column on save — the same trap the four billing
            // fields above document (Stage 9).
            propertyType: summary.propertyType,
            // Same trap again (Stage 10): without this the modal opens every
            // job on "Auto" and un-pins a deliberately pinned checklist on save.
            checklistTemplateId: summary.checklistTemplateId,
            taxExempt: summary.taxExempt,
            cleaners: summary.cleaners.map((c) => ({ id: c.id, name: c.name })),
            addOns: summary.money.addOnLines.map((l, i) => ({
              id: `${summary.id}-addon-${i}`,
              name: l.name,
              price: l.unitPrice,
              quantity: l.quantity,
            })),
            bookingSource: summary.bookingSource,
            // Without this the modal would re-derive the mode from provenance
            // and an override job edited from the calendar would open on the
            // wrong one (fix 2).
            pricingMode: summary.pricingMode,
            isCashJob: summary.isCashJob,
            subtotalAmount: summary.money.subtotalAmount,
          }}
          onSubmit={async (formData) => {
            // Preserve the booking's LENGTH across an edit. JobModal has no
            // end-date/end-time field, and saveJob writes
            // `endTime: endDate && endTime ? … : null` — so submitting the
            // modal without them silently drops the end time. Everywhere else
            // that costs a line on a detail page; on the calendar it is visible
            // damage, because the week/day card is sized from end − start and
            // an edited 3-hour job would shrink to the 1-hour default. The
            // duration is re-hung off whatever start the admin submitted, in
            // store wall-clock, so moving the job keeps its length.
            // (Calendar.tsx's create flow sets the same two keys.)
            const durationMs = summary.endTimeIso
              ? new Date(summary.endTimeIso).getTime() -
                new Date(summary.startTimeIso).getTime()
              : 0;
            const startDate = String(formData.get("startDate") ?? "");
            const startTime = String(formData.get("startTime") ?? "");
            if (durationMs > 0 && startDate && startTime) {
              const end = new Date(
                storeWallClockToUtc(startDate, startTime).getTime() + durationMs
              );
              const parts = storeInputParts(end);
              formData.set("endDate", parts.date);
              formData.set("endTime", parts.time);
            }
            const result = await saveJob(formData);
            if (result.success) {
              setEditOpen(false);
              await reloadSummary();
              refreshEvents();
            }
            return result;
          }}
        />
      ) : null}
    </>
  );
}
