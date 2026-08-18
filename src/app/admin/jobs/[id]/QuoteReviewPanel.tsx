"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  HardHat,
  Send,
  XCircle,
} from "lucide-react";
import { sendJobQuote } from "@/app/admin/actions/sendJobQuote";
import { resolveJobQuote } from "@/app/admin/actions/resolveJobQuote";
import {
  DEPOSIT_DISPOSITIONS,
  DEPOSIT_DISPOSITION_HINT,
  DEPOSIT_DISPOSITION_LABEL,
  QUOTE_STATUS_HINT,
  QUOTE_STATUS_LABEL,
  QUOTE_STATUS_TONE,
  type DepositDisposition,
  type QuoteStatus,
} from "@/lib/quote-status";
import { formatDeposit } from "@/lib/booking-deposit";
import { formatHours } from "@/lib/hourly-billing";

/**
 * The admin's quote-review surface (PDF #9, Stage 11, steps 11.4 + 11.6):
 * *"admin can review photos, adjust the quote, and send the final price"*, and on
 * a decline *"clear refund / keep / adjust options for the deposit"*.
 *
 * A separate component rather than another 300 lines inside JobDetailView (which
 * is already ~4,000): it renders for the small minority of jobs that are quotes,
 * owns its own form state, and calls two actions nothing else on the page calls.
 *
 * It shows the CUSTOMER'S photos specifically — the ones with no uploader — rather
 * than every photo on the job. On a post-construction job that later gets worked,
 * the crew's before/after shots would otherwise bury the three photos the price
 * was set from.
 */

interface Photo {
  id: string;
  url: string;
  caption: string | null;
  createdAt: string;
  employee: { id: string; name: string } | null;
}

interface Props {
  jobId: string;
  quoteStatus: QuoteStatus;
  quotedAt: string | null;
  /** The customer's own estimate, as booked. */
  pcHours: number | null;
  pcCleaners: number | null;
  /** Already collected, and credited against whatever is quoted. */
  depositAmount: number;
  /** How much of the deposit is still refundable (deposit − refunded so far). */
  depositRemaining: number;
  /** Current stored figures, so the form opens on what the job already says. */
  currentPrice: number | null;
  currentTotal: number | null;
  billingType: string | null;
  billedHourlyRate: number | null;
  billedEstimatedHours: number | null;
  /** Every photo on the job; booking photos are picked out below. */
  photos: Photo[];
  /**
   * How many add-on rows the booking carries. A quote is stored FINAL_PRICE, so
   * add-ons are itemised INSIDE the quoted total rather than charged on top — the
   * admin has to know that before typing a number.
   */
  addOnCount: number;
  /** Opens the existing full-page lightbox by index into `photos`. */
  onOpenPhoto: (index: number) => void;
}

type Mode = "HOURLY" | "FLAT";

export default function QuoteReviewPanel({
  jobId,
  quoteStatus,
  quotedAt,
  pcHours,
  pcCleaners,
  depositAmount,
  depositRemaining,
  currentPrice,
  currentTotal,
  billingType,
  billedHourlyRate,
  billedEstimatedHours,
  photos,
  addOnCount,
  onOpenPhoto,
}: Props) {
  // Default to HOURLY: post-construction is quoted per cleaner-hour, and the
  // customer's own estimate is already expressed that way, so the admin's first
  // move is almost always "adjust their hours and rate".
  const [mode, setMode] = useState<Mode>(
    billingType === "HOURLY" || !currentPrice ? "HOURLY" : "FLAT"
  );
  const [rate, setRate] = useState(
    billedHourlyRate != null ? String(billedHourlyRate) : ""
  );
  const [hours, setHours] = useState(
    billedEstimatedHours != null
      ? String(billedEstimatedHours)
      : pcHours != null
        ? String(pcHours)
        : ""
  );
  const [flatPrice, setFlatPrice] = useState(
    currentPrice != null ? String(currentPrice) : ""
  );
  const [message, setMessage] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Decline flow (D11) — no default disposition, so the admin has to choose.
  const [declining, setDeclining] = useState(false);
  const [disposition, setDisposition] = useState<DepositDisposition | "">("");
  const [partialAmount, setPartialAmount] = useState("");
  const [declineReason, setDeclineReason] = useState("");

  const bookingPhotos = photos
    .map((p, index) => ({ p, index }))
    .filter(({ p }) => p.employee === null);

  const tone = QUOTE_STATUS_TONE[quoteStatus];
  const toneColor =
    tone === "ok" ? "#16a34a" : tone === "critical" ? "#dc2626" : "#b45309";

  // Live preview of the service line the admin is about to send. Pre-tax, and
  // labelled as such — the taxed total is computed server-side from the live
  // rates, and printing a guess at it here would give the admin a number the
  // email then contradicts.
  const previewService =
    mode === "HOURLY"
      ? (Number(rate) || 0) * (Number(hours) || 0)
      : Number(flatPrice) || 0;

  async function submitQuote() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await sendJobQuote({
      jobId,
      billingType: mode,
      ...(mode === "HOURLY"
        ? {
            billedHourlyRate: Number(rate),
            billedEstimatedHours: Number(hours),
          }
        : { price: Number(flatPrice) }),
      message: message.trim() || undefined,
    });
    setBusy(false);
    if (!res.success) {
      setError(res.error ?? "Couldn't send the quote.");
      return;
    }
    // `warning` is the "priced but not emailed" case — surfaced, never swallowed,
    // because an admin who believes a quote went out will wait for a reply.
    if (res.warning) setError(res.warning);
    else
      setNotice(
        `Quote sent — $${res.total?.toFixed(2)} total, $${res.balanceDue?.toFixed(
          2
        )} due after the deposit.`
      );
  }

  async function decide(decision: "ACCEPTED" | "DECLINED") {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await resolveJobQuote({
      jobId,
      decision,
      ...(decision === "DECLINED"
        ? {
            disposition: (disposition || undefined) as DepositDisposition | undefined,
            refundAmount:
              disposition === "PARTIAL" ? Number(partialAmount) : undefined,
            reason: declineReason.trim() || undefined,
          }
        : {}),
    });
    setBusy(false);
    if (!res.success) {
      setError(res.error ?? "Couldn't record that.");
      return;
    }
    if (res.warning) setError(res.warning);
    else
      setNotice(
        decision === "ACCEPTED"
          ? "Accepted — the job is schedulable and visible to cleaners."
          : "Declined and recorded."
      );
    setDeclining(false);
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--primary-15)",
    fontSize: 14,
    color: "var(--ink)",
    background: "#fff",
  };
  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--primary-60)",
    marginBottom: 5,
  };

  return (
    <div
      className="dcard"
      style={{ borderLeft: `3px solid ${toneColor}` }}>
      <div className="dcard-head">
        <h3
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}>
          <HardHat size={16} style={{ color: toneColor }} />
          Quote review
        </h3>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: toneColor,
          }}>
          {QUOTE_STATUS_LABEL[quoteStatus]}
        </span>
      </div>

      <p
        style={{
          margin: "0 0 14px",
          fontSize: 13,
          lineHeight: 1.55,
          color: "var(--primary-70)",
        }}>
        {QUOTE_STATUS_HINT[quoteStatus]}
        {quotedAt
          ? ` Quote sent ${new Date(quotedAt).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}.`
          : ""}
      </p>

      {/* What the customer asked for and what they already paid. The crew size is
          here because it is the number the deposit was priced against AND the
          number `requiredCleaners` was set from — an admin quoting a different
          crew needs to see the difference. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          gap: 10,
          padding: "12px 14px",
          borderRadius: 10,
          background: "rgba(0,140,156,0.06)",
          marginBottom: 14,
        }}>
        <div>
          <span style={labelStyle}>Customer estimate</span>
          <span style={{ fontSize: 14, color: "var(--ink)" }}>
            {pcHours != null ? formatHours(pcHours) : "—"}
            {pcCleaners != null
              ? ` · ${pcCleaners} cleaner${pcCleaners === 1 ? "" : "s"}`
              : ""}
          </span>
        </div>
        <div>
          <span style={labelStyle}>Deposit paid</span>
          <span style={{ fontSize: 14, color: "var(--ink)" }}>
            {formatDeposit(depositAmount)}
          </span>
        </div>
        <div>
          <span style={labelStyle}>Current total</span>
          <span style={{ fontSize: 14, color: "var(--ink)" }}>
            {currentTotal != null ? `$${currentTotal.toFixed(2)}` : "—"}
          </span>
        </div>
      </div>

      {/* ── Photos the price is set from ───────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <span style={labelStyle}>
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Camera size={12} /> Customer photos · {bookingPhotos.length}
          </span>
        </span>
        {bookingPhotos.length === 0 ? (
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              padding: "10px 12px",
              borderRadius: 8,
              background: "rgba(220,38,38,0.06)",
              color: "#b91c1c",
              fontSize: 12.5,
            }}>
            <AlertTriangle size={14} />
            No customer photos on this request — price it from the notes, or call
            them before quoting.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))",
              gap: 8,
            }}>
            {bookingPhotos.map(({ p, index }) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onOpenPhoto(index)}
                aria-label={p.caption || "Customer photo"}
                style={{
                  padding: 0,
                  border: "1px solid var(--primary-10)",
                  borderRadius: 8,
                  overflow: "hidden",
                  aspectRatio: "1 / 1",
                  cursor: "pointer",
                  background: "var(--primary-10)",
                }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.url}
                  alt={p.caption || "Customer photo"}
                  loading="lazy"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Price the job ─────────────────────────────────────────────────── */}
      {(quoteStatus === "PENDING_REVIEW" || quoteStatus === "QUOTED") && (
        <div style={{ borderTop: "1px solid var(--primary-10)", paddingTop: 14 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {(["HOURLY", "FLAT"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 999,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  border: `1px solid ${
                    mode === m ? "var(--primary)" : "var(--primary-15)"
                  }`,
                  background: mode === m ? "var(--primary)" : "#fff",
                  color: mode === m ? "#fff" : "var(--primary-70)",
                }}>
                {m === "HOURLY" ? "Hourly" : "Flat price"}
              </button>
            ))}
          </div>

          {mode === "HOURLY" ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginBottom: 12,
              }}>
              <div>
                <label style={labelStyle} htmlFor="qr-rate">
                  Customer hourly rate ($)
                </label>
                <input
                  id="qr-rate"
                  type="number"
                  min="0"
                  step="1"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  style={inputStyle}
                  placeholder="e.g. 60"
                />
              </div>
              <div>
                <label style={labelStyle} htmlFor="qr-hours">
                  Quoted hours
                </label>
                <input
                  id="qr-hours"
                  type="number"
                  min="0"
                  step="0.25"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  style={inputStyle}
                  placeholder="e.g. 8"
                />
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle} htmlFor="qr-flat">
                Quoted price, before tax ($)
              </label>
              <input
                id="qr-flat"
                type="number"
                min="0"
                step="1"
                value={flatPrice}
                onChange={(e) => setFlatPrice(e.target.value)}
                style={inputStyle}
                placeholder="e.g. 700"
              />
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle} htmlFor="qr-msg">
              Note for the customer (optional)
            </label>
            <textarea
              id="qr-msg"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              style={{ ...inputStyle, resize: "vertical" }}
              placeholder="Scope, assumptions, anything excluded — included in the quote email."
            />
          </div>

          {previewService > 0 && (
            <p
              style={{
                margin: "0 0 12px",
                fontSize: 12.5,
                color: "var(--primary-70)",
              }}>
              {mode === "HOURLY"
                ? `${formatHours(Number(hours) || 0)} × $${(
                    Number(rate) || 0
                  ).toFixed(2)}/hr = `
                : ""}
              <strong>${previewService.toFixed(2)}</strong> before tax
              {depositAmount > 0
                ? ` · ${formatDeposit(depositAmount)} deposit comes off the taxed total`
                : ""}
              . Taxes are added server-side at the current rates.
            </p>
          )}

          {/* A quote is stored as FINAL_PRICE, which is the same mode every web
              booking already uses: add-on rows become an ITEMISATION of the number
              typed above rather than something added on top. Said out loud here so
              an admin doesn't quote the service and expect the add-ons to be
              billed on top of it. */}
          {addOnCount > 0 && (
            <p
              style={{
                margin: "0 0 12px",
                fontSize: 12,
                color: "var(--primary-60)",
              }}>
              This job has {addOnCount} add-on{addOnCount === 1 ? "" : "s"} —
              include {addOnCount === 1 ? "it" : "them"} in the figure above. A
              quote is one agreed total, so add-on rows are itemised inside it, not
              charged on top.
            </p>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={submitQuote}
              disabled={busy || previewService <= 0}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "9px 18px",
                borderRadius: 9,
                border: "none",
                background: "var(--primary)",
                color: "#fff",
                fontSize: 13.5,
                fontWeight: 600,
                cursor: busy || previewService <= 0 ? "not-allowed" : "pointer",
                opacity: busy || previewService <= 0 ? 0.55 : 1,
              }}>
              <Send size={14} />
              {busy
                ? "Working…"
                : quoteStatus === "QUOTED"
                  ? "Re-send updated quote"
                  : "Send final quote"}
            </button>
          </div>
        </div>
      )}

      {/* ── Record the customer's answer (D10: manual flip) ───────────────── */}
      {quoteStatus === "QUOTED" && (
        <div style={{ borderTop: "1px solid var(--primary-10)", marginTop: 14, paddingTop: 14 }}>
          <span style={labelStyle}>Customer&apos;s answer</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: declining ? 12 : 0 }}>
            <button
              type="button"
              onClick={() => decide("ACCEPTED")}
              disabled={busy}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                borderRadius: 9,
                border: "1px solid rgba(22,163,74,0.35)",
                background: "rgba(22,163,74,0.08)",
                color: "#15803d",
                fontSize: 13,
                fontWeight: 600,
                cursor: busy ? "not-allowed" : "pointer",
              }}>
              <CheckCircle2 size={14} /> Accepted — schedule it
            </button>
            <button
              type="button"
              onClick={() => setDeclining((v) => !v)}
              disabled={busy}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                borderRadius: 9,
                border: "1px solid rgba(220,38,38,0.3)",
                background: declining ? "rgba(220,38,38,0.1)" : "#fff",
                color: "#b91c1c",
                fontSize: 13,
                fontWeight: 600,
                cursor: busy ? "not-allowed" : "pointer",
              }}>
              <XCircle size={14} /> Declined
            </button>
          </div>

          {declining && (
            <div
              style={{
                padding: "12px 14px",
                borderRadius: 10,
                background: "rgba(220,38,38,0.05)",
                border: "1px solid rgba(220,38,38,0.15)",
              }}>
              <span style={labelStyle}>
                What happens to the {formatDeposit(depositAmount)} deposit?
              </span>
              {/* All three, no default (D11). The company has not stated a policy,
                  so the app must not invent one on the admin's behalf. */}
              <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                {DEPOSIT_DISPOSITIONS.map((d) => (
                  <label
                    key={d}
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "flex-start",
                      fontSize: 13,
                      color: "var(--ink)",
                      cursor: "pointer",
                    }}>
                    <input
                      type="radio"
                      name="qr-disposition"
                      checked={disposition === d}
                      onChange={() => setDisposition(d)}
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      {DEPOSIT_DISPOSITION_LABEL[d]}
                      <span
                        style={{
                          display: "block",
                          fontSize: 11.5,
                          color: "var(--primary-60)",
                        }}>
                        {DEPOSIT_DISPOSITION_HINT[d]}
                        {d !== "KEEP"
                          ? ` Up to ${formatDeposit(depositRemaining)} remaining.`
                          : ""}
                      </span>
                    </span>
                  </label>
                ))}
              </div>

              {disposition === "PARTIAL" && (
                <div style={{ marginBottom: 10 }}>
                  <label style={labelStyle} htmlFor="qr-partial">
                    Refund amount ($)
                  </label>
                  <input
                    id="qr-partial"
                    type="number"
                    min="0"
                    max={depositRemaining}
                    step="0.01"
                    value={partialAmount}
                    onChange={(e) => setPartialAmount(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              )}

              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle} htmlFor="qr-decline-reason">
                  Reason{disposition === "REFUND" ? " (optional)" : ""}
                </label>
                <textarea
                  id="qr-decline-reason"
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  rows={2}
                  style={{ ...inputStyle, resize: "vertical" }}
                  placeholder="Recorded on the booking — the customer may ask."
                />
              </div>

              <button
                type="button"
                onClick={() => decide("DECLINED")}
                disabled={busy || !disposition}
                style={{
                  padding: "8px 16px",
                  borderRadius: 9,
                  border: "none",
                  background: "#b91c1c",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: busy || !disposition ? "not-allowed" : "pointer",
                  opacity: busy || !disposition ? 0.55 : 1,
                }}>
                {busy ? "Working…" : "Record decline"}
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            borderRadius: 8,
            background: "rgba(220,38,38,0.07)",
            color: "#b91c1c",
            fontSize: 12.5,
            lineHeight: 1.5,
          }}>
          {error}
        </div>
      )}
      {notice && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            borderRadius: 8,
            background: "rgba(22,163,74,0.08)",
            color: "#15803d",
            fontSize: 12.5,
            lineHeight: 1.5,
          }}>
          {notice}
        </div>
      )}
    </div>
  );
}
