"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { CreditCard, Loader2, ShieldCheck, Tag, CheckCircle2, Banknote } from "lucide-react";
import { applyPromoCode } from "../../actions/applyPromoCode";
import { BookingDraft, SERVICE_TYPES } from "../types";
import {
  BOOKING_PAGE_DEFAULTS,
  frequencyLabel,
  type BookingPageConfig,
} from "@/lib/booking-page-config";
import { formatAddressLine } from "@/lib/client-address";
import { calculateTax } from "@/lib/tax";
import { addOnLineTotal, sumAddOns } from "@/lib/job-money";
import { normalizeJobType } from "@/lib/calendar-labels";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

interface Props {
  draft: BookingDraft;
  basePrice: number;
  onChange: (patch: Partial<BookingDraft>) => void;
  /** Per-service-category recurring discount table (item 7). */
  freqDiscounts?: Record<string, Record<string, number>>;
  /** Admin-editable field layout (item 17) — source of frequency labels. */
  bookingPage?: BookingPageConfig;
}

export default function Step5Review({
  draft,
  basePrice,
  onChange,
  freqDiscounts = {},
  bookingPage = BOOKING_PAGE_DEFAULTS,
}: Props) {
  const breakdown = useMemo(() => {
    const addOnTotal = sumAddOns(draft.addOns.filter((a) => a.selected));
    // GROSS pre-tax subtotal. This is the figure a promo code is quoted
    // against, and the same one `submitBooking` re-resolves the code against
    // server-side, so the discount shown here is the discount that is applied.
    const subtotal = basePrice + addOnTotal + draft.travelFee;
    const promoDiscount =
      draft.promoApplied && draft.promoDiscount
        ? Math.min(draft.promoDiscount, subtotal)
        : 0;
    // The promo comes off BEFORE tax, exactly as the server does it
    // (`computeBookingPrice` folds every discount into the pre-tax amount), so
    // GST/QST are charged on what the customer actually pays. Subtracting it
    // from the taxed total instead quotes a total the booking never gets
    // charged — the same class of bug as not applying it at all.
    const tax = calculateTax(subtotal - promoDiscount);
    return {
      addOnTotal,
      subtotal: Math.round(subtotal * 100) / 100,
      promoDiscount,
      gstAmount: tax.gstAmount,
      qstAmount: tax.qstAmount,
      total: tax.total,
    };
  }, [draft, basePrice]);

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [stripeError, setStripeError] = useState<string | null>(null);

  // Promo code
  const [promoMsg, setPromoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [, startPromoTransition] = useTransition();

  function handleApplyPromo() {
    if (!draft.promoCode?.trim()) return;
    startPromoTransition(async () => {
      const res = await applyPromoCode(draft.promoCode!, breakdown.subtotal);
      if (res.valid) {
        onChange({ promoDiscount: res.discountAmount, promoApplied: true });
        setPromoMsg({ ok: true, text: `Code applied — ${res.discountAmount! < 1 ? "" : "-"}$${res.discountAmount!.toFixed(2)} off` });
      } else {
        onChange({ promoDiscount: 0, promoApplied: false });
        setPromoMsg({ ok: false, text: res.message ?? "Invalid code" });
      }
    });
  }

  // Validate a code entered back in step 4 as soon as the customer lands here,
  // instead of waiting for them to press "Apply code". The server honours any
  // valid code at submit, so a code that is silently ignored by this screen
  // would quote a total higher than the one actually charged. Invalid codes
  // stay quiet — the explicit button is what surfaces the reason.
  const promoCodeTrimmed = draft.promoCode?.trim() ?? "";
  const promoSubtotal = breakdown.subtotal;
  const promoAlreadyApplied = draft.promoApplied === true;
  useEffect(() => {
    if (!promoCodeTrimmed || promoAlreadyApplied) return;
    let cancelled = false;
    applyPromoCode(promoCodeTrimmed, promoSubtotal)
      .then((res) => {
        if (cancelled || !res.valid || !res.discountAmount) return;
        onChange({ promoDiscount: res.discountAmount, promoApplied: true });
        setPromoMsg({
          ok: true,
          text: `Code applied — -$${res.discountAmount.toFixed(2)} off`,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promoCodeTrimmed, promoSubtotal, promoAlreadyApplied]);

  // Create a $20 deposit PaymentIntent when contact info is known
  useEffect(() => {
    if (!draft.email || !draft.name) return;
    setStripeLoading(true);
    setStripeError(null);
    fetch("/api/stripe/charge-deposit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: draft.email, name: draft.name }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.clientSecret) {
          setClientSecret(data.clientSecret);
          onChange({ stripeCustomerId: data.customerId });
        } else {
          setStripeError("Could not initialise payment. Please refresh.");
        }
      })
      .catch(() => setStripeError("Could not initialise payment. Please refresh."))
      .finally(() => setStripeLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.email, draft.name]);

  const service = SERVICE_TYPES.find((s) => s.value === draft.serviceType);
  // Per-service label from the admin config. The old lookup searched only the
  // standard list, so every Airbnb-only frequency (twice-weekly, daily/20+)
  // reviewed as "—" even though it priced correctly.
  const freqText = frequencyLabel(bookingPage, draft.serviceType, draft.frequency);

  // Recurring discount for the 2nd+ cleaning, from the admin config (item 7).
  const isAirbnb = draft.serviceType === "AIRBNB";
  const discountCategory = normalizeJobType(draft.serviceType) ?? "RESIDENTIAL";
  const recurringPct =
    draft.frequency === "ONE_TIME"
      ? 0
      : freqDiscounts[discountCategory]?.[draft.frequency] ??
        freqDiscounts.RESIDENTIAL?.[draft.frequency] ??
        0;

  const propertyLine = [
    `${draft.bedCount} bed`,
    `${draft.bathCount} bath${draft.halfBathCount ? ` + ${draft.halfBathCount} half` : ""}`,
    draft.squareFootage > 0 ? `${draft.squareFootage} sq ft` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const dateLine = draft.date
    ? `${new Date(draft.date).toLocaleDateString("en-US", { weekday: "long" })} · ${
        draft.isFlexible ? "Flexible time" : formatSlot(draft.timeSlot)
      }`
    : "—";

  return (
    <div className="cl-stack-32">
      <header className="cl-stack-8">
        <p className="cl-eyebrow">Step 5 · Final</p>
        <h1 className="cl-display" style={{ fontSize: "clamp(34px, 4.4vw, 52px)" }}>
          Review your
          <br />
          <em>booking.</em>
        </h1>
        <p className="cl-subtitle">
          A <strong>$20 deposit</strong> is charged today to secure your booking. The remaining balance is charged after your cleaning is complete.
        </p>
      </header>

      <div className="cl-card-soft">
        <span className="cl-label" style={{ display: "block", marginBottom: 14 }}>
          Service
        </span>
        <dl className="cl-dlist">
          <Row dt="Type" dd={service?.label ?? "—"} />
          <Row dt="Frequency" dd={freqText} />
          <Row
            dt="Address"
            dd={
              formatAddressLine({
                address: draft.address,
                aptNumber: draft.aptNumber,
              }) || "—"
            }
          />
          <Row dt="Property" dd={propertyLine} />
          <Row dt="Date" dd={dateLine} />
        </dl>
      </div>

      <div className="cl-card-soft">
        <span className="cl-label" style={{ display: "block", marginBottom: 14 }}>
          Price breakdown
        </span>
        <dl className="cl-dlist">
          <Row dt="Base service" dd={`$${basePrice.toFixed(2)}`} />
          {/* Keyed on the catalog id, not the name: two catalog rows can share
              a name (the settings editor seeds a blank one and never dedupes),
              and a duplicate React key silently drops a row from the review. */}
          {draft.addOns
            .filter((a) => a.selected)
            .map((a, i) => (
              <Row
                key={a.id ?? `${a.name}-${i}`}
                dt={
                  a.quantity > 1
                    ? `${a.name} ×${a.quantity} · $${a.price.toFixed(2)} each`
                    : a.name
                }
                dd={`+$${addOnLineTotal(a).toFixed(2)}`}
              />
            ))}
          {draft.travelFee > 0 ? (
            <Row dt="Travel fee" dd={`+$${draft.travelFee.toFixed(2)}`} />
          ) : null}
          <RowBorder dt="Subtotal" dd={`$${breakdown.subtotal.toFixed(2)}`} />
          {breakdown.promoDiscount > 0 ? (
            <Row dt={`Promo (${draft.promoCode})`} dd={`-$${breakdown.promoDiscount.toFixed(2)}`} />
          ) : null}
          <Row dt="GST (5%)" dd={`$${breakdown.gstAmount.toFixed(2)}`} />
          <Row dt="QST (9.975%)" dd={`$${breakdown.qstAmount.toFixed(2)}`} />
          <RowBorder total dt="Total (1st cleaning)" dd={`$${breakdown.total.toFixed(2)}`} />
          {recurringPct > 0 && (
            <div className="cl-dlist-row" style={{ marginTop: 6 }}>
              <dt style={{ color: "var(--primary)", fontSize: 12 }}>
                {recurringPct}% off {isAirbnb ? "every visit" : "from 2nd cleaning"}
              </dt>
              <dd style={{ color: "var(--primary)", fontSize: 12, fontWeight: 600 }}>
                −${(basePrice * (recurringPct / 100)).toFixed(2)}/visit
              </dd>
            </div>
          )}
          <div className="cl-dlist-row" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--primary-15)" }}>
            <dt style={{ color: "var(--primary)", fontWeight: 600 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Banknote size={15} />
                Due today (deposit)
              </span>
            </dt>
            <dd style={{ color: "var(--primary)", fontWeight: 700 }}>$20.00</dd>
          </div>
          <div className="cl-dlist-row">
            <dt style={{ color: "var(--primary-50)", fontSize: 12 }}>Remaining balance</dt>
            <dd style={{ color: "var(--primary-50)", fontSize: 12 }}>After cleaning</dd>
          </div>
        </dl>
      </div>

      {/* Promo code apply */}
      {draft.promoCode && !draft.promoApplied && (
        <div className="cl-card-soft cl-stack-8">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Tag size={16} style={{ color: "var(--primary)" }} />
            <span style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>
              Promo code: <code style={{ fontFamily: "monospace" }}>{draft.promoCode}</code>
            </span>
          </div>
          {promoMsg && !promoMsg.ok && (
            <p style={{ fontSize: 13, color: "var(--red, #dc2626)" }}>{promoMsg.text}</p>
          )}
          <button
            type="button"
            onClick={handleApplyPromo}
            style={{ alignSelf: "flex-start", padding: "8px 20px", borderRadius: 8, background: "var(--primary)", color: "#fff", fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer" }}>
            Apply code
          </button>
        </div>
      )}
      {draft.promoApplied && promoMsg?.ok && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "var(--primary)" }}>
          <CheckCircle2 size={16} /> {promoMsg.text}
        </div>
      )}

      {/* Stripe deposit charge */}
      <div className="cl-card-soft cl-stack-12">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <CreditCard size={20} style={{ color: "var(--primary)" }} />
          <span style={{ fontWeight: 600, fontSize: 15, color: "var(--ink)" }}>
            Pay $20 deposit &amp; save card
          </span>
        </div>
        <p style={{ fontSize: 13, color: "var(--primary-70)", margin: "0 0 16px", lineHeight: 1.55 }}>
          A $20 deposit is charged now to secure your booking. Your card is saved for the remaining balance after cleaning. Apple Pay and Google Pay accepted.
        </p>

        {stripeLoading && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--primary-60)", fontSize: 14 }}>
            <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
            Loading payment form…
          </div>
        )}

        {stripeError && (
          <p style={{ color: "var(--red, #dc2626)", fontSize: 13 }}>{stripeError}</p>
        )}

        {clientSecret && !stripeLoading && (
          <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "stripe" } }}>
            <CardForm onChange={onChange} />
          </Elements>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, color: "var(--primary-50)", fontSize: 12 }}>
          <ShieldCheck size={13} />
          Secured by Stripe · 256-bit encryption
        </div>
      </div>
    </div>
  );
}

function CardForm({ onChange }: { onChange: (p: Partial<BookingDraft>) => void }) {
  const stripe = useStripe();
  const elements = useElements();

  // Returns { paymentIntentId, paymentMethodId } on success, or null on failure
  async function confirm(): Promise<{ paymentIntentId: string; paymentMethodId: string } | null> {
    if (!stripe || !elements) return null;
    const result = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });
    if (result.error) {
      // If the PI was already confirmed on a previous attempt (e.g. booking
      // creation failed after the charge succeeded), Stripe returns the
      // existing succeeded PI in the error — reuse it instead of failing.
      const pi = result.error.payment_intent;
      if (pi?.status === "succeeded") {
        return {
          paymentIntentId: pi.id,
          paymentMethodId: pi.payment_method as string,
        };
      }
      return null;
    }
    const pi = result.paymentIntent;
    return {
      paymentIntentId: pi.id,
      paymentMethodId: pi.payment_method as string,
    };
  }

  // Expose confirm handle so the parent page can call it before submitting the booking
  useEffect(() => {
    (window as any).__stripeConfirmCard = confirm;
    return () => { delete (window as any).__stripeConfirmCard; };
  });

  return (
    <PaymentElement
      options={{ layout: "tabs" }}
      onChange={(e) => {
        if (e.complete) {
          onChange({ stripeCardReady: true });
        } else {
          onChange({ stripeCardReady: false });
        }
      }}
    />
  );
}

function Row({ dt, dd }: { dt: string; dd: React.ReactNode }) {
  return (
    <div className="cl-dlist-row">
      <dt>{dt}</dt>
      <dd>{dd}</dd>
    </div>
  );
}

function RowBorder({ dt, dd, total }: { dt: string; dd: React.ReactNode; total?: boolean }) {
  return (
    <div className={`cl-dlist-row with-border ${total ? "total" : ""}`}>
      <dt>{dt}</dt>
      <dd>{dd}</dd>
    </div>
  );
}

function formatSlot(slot: string): string {
  if (!slot) return "—";
  const [h] = slot.split(":");
  const hour = parseInt(h);
  return `${hour > 12 ? hour - 12 : hour} ${hour >= 12 ? "PM" : "AM"}`;
}
