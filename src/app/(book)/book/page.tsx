"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { BookingDraft, EMPTY_DRAFT, AIRBNB_FREQUENCIES, PC_HOURLY_RATE } from "./types";
import Step1PostalCode from "./steps/Step1PostalCode";
import Step2Property from "./steps/Step2Property";
import Step3Schedule from "./steps/Step3Schedule";
import Step4Contact from "./steps/Step4Contact";
import Step5Review from "./steps/Step5Review";
import { saveLead } from "../actions/saveLead";
import { getQuote } from "../actions/getQuote";
import { submitBooking } from "../actions/submitBooking";
import { getBookingConfig } from "../actions/getBookingConfig";
import { calculateTax } from "@/lib/tax";
import { isValidEmail, isValidPhone } from "@/lib/validation";
import { AFTER_PHOTO_CONSENT_TEXT } from "@/lib/policy";
import CustomerLogo from "@/components/customer/Logo";
import { Button, Banner } from "@/components/customer/Field";
import { authClient } from "@/lib/auth-client";

const STEP_LABELS = [
  "Postal code",
  "Property",
  "Schedule",
  "Contact",
  "Review",
] as const;

const STEP_HINTS = [
  "Coverage check",
  "Size and service",
  "Date & time",
  "About you",
  "Confirm & book",
] as const;

export default function BookPage() {
  const session = authClient.useSession();
  const loggedInUser = session.data?.session
    ? (session.data.user as { name?: string | null; email?: string | null; role?: string | null })
    : null;
  const isLoggedInClient =
    !!loggedInUser && (loggedInUser.role === "CLIENT" || !loggedInUser.role);

  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<BookingDraft>(EMPTY_DRAFT);
  const [basePrice, setBasePrice] = useState(0);
  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmedTotal, setConfirmedTotal] = useState<number | null>(null);

  // Hard guard against double-submit. The button is disabled while
  // `submitting` is true, but state updates are async so a fast double-click
  // could fire two requests. This ref blocks the second one synchronously.
  const submittingRef = useRef(false);

  // Pre-fill contact info when the visitor is already signed in.
  useEffect(() => {
    if (!isLoggedInClient || !loggedInUser) return;
    setDraft((d) => ({
      ...d,
      name: d.name || loggedInUser.name || "",
      email: d.email || loggedInUser.email || "",
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedInClient, loggedInUser?.email]);

  // Load admin-managed add-on catalog on first mount.
  useEffect(() => {
    let cancelled = false;
    getBookingConfig().then(({ addOns }) => {
      if (cancelled) return;
      setDraft((d) =>
        d.addOns.length > 0
          ? d
          : {
              ...d,
              addOns: addOns.map((a) => ({
                id: a.id,
                name: a.name,
                price: a.price,
                roomType: a.roomType,
                selected: false,
              })),
            }
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Hot-lead incremental save — debounced once email is entered.
  const leadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!draft.email.includes("@")) return;
    if (leadTimer.current) clearTimeout(leadTimer.current);
    leadTimer.current = setTimeout(() => {
      saveLead({
        email: draft.email,
        name: draft.name,
        phone: draft.phone,
        postalCode: draft.postalCode,
        dropOffStep: step,
        serviceType: draft.serviceType,
        bedCount: draft.bedCount,
        bathCount: draft.bathCount,
        halfBathCount: draft.halfBathCount,
        squareFootage: draft.squareFootage,
        preferredDate: draft.date || null,
        isFlexible: draft.isFlexible,
        preferredSlot: draft.timeSlot,
        payload: {
          frequency: draft.frequency,
          address: draft.address,
          addOns: draft.addOns.filter((a) => a.selected).map((a) => a.name),
          notes: draft.notes,
          referralCode: draft.referralCode,
        },
        source: "web",
      }).catch(() => {});
    }, 1200);
    return () => {
      if (leadTimer.current) clearTimeout(leadTimer.current);
    };
  }, [draft, step]);

  // Live quote refresh on Property/Review steps (skip for post-construction — uses hourly rate)
  useEffect(() => {
    if (step < 1) return;
    if (draft.serviceType === "POST_CONSTRUCTION") return;
    getQuote({ bedCount: draft.bedCount, bathCount: draft.bathCount })
      .then((r) => {
        if (r.success && r.basePrice) setBasePrice(r.basePrice);
      })
      .catch(() => {});
  }, [step, draft.bedCount, draft.bathCount, draft.serviceType]);

  function patch(p: Partial<BookingDraft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function canProceed(): boolean {
    switch (step) {
      case 0:
        return draft.postalCovered === true;
      case 1:
        return !!(draft.address.trim() && draft.serviceType && draft.frequency);
      case 2:
        return !!(draft.date && (draft.isFlexible || draft.timeSlot));
      case 3:
        return !!(
          draft.name.trim() &&
          isValidEmail(draft.email) &&
          isValidPhone(draft.phone)
        );
      case 4:
        return agree && !!draft.stripeCardReady;
      default:
        return false;
    }
  }

  function next() {
    if (!canProceed()) return;
    if (step === 4) {
      handleSubmit();
      return;
    }
    setStep((s) => s + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function back() {
    setStep((s) => Math.max(0, s - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit() {
    if (submittingRef.current) return; // block double-click
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);

    // Confirm the $20 deposit payment first
    const confirmFn = (window as any).__stripeConfirmCard as
      | (() => Promise<{ paymentIntentId: string; paymentMethodId: string } | null>)
      | undefined;

    let depositPaymentIntentId: string | undefined;
    let stripePaymentMethodId: string | undefined;

    if (confirmFn) {
      const depositResult = await confirmFn();
      if (!depositResult) {
        setSubmitError("Payment failed. Please check your card details and try again.");
        setSubmitting(false);
        submittingRef.current = false;
        return;
      }
      depositPaymentIntentId = depositResult.paymentIntentId;
      stripePaymentMethodId = depositResult.paymentMethodId;
    }

    const res = await submitBooking({
      postalCode: draft.postalCode,
      address: draft.address,
      bedCount: draft.bedCount,
      bathCount: draft.bathCount,
      halfBathCount: draft.halfBathCount,
      squareFootage: draft.squareFootage,
      serviceType: draft.serviceType,
      frequency: draft.frequency,
      addOns: draft.addOns
        .filter((a) => a.selected)
        .map((a) => ({ name: a.name, price: a.price })),
      date: draft.date,
      isFlexible: draft.isFlexible,
      timeSlot: draft.timeSlot,
      name: draft.name,
      phone: draft.phone,
      email: draft.email,
      notes: [
        draft.notes,
        isPC ? `Post-construction: ${draft.pcHours}h × ${draft.pcCleaners} cleaner(s) × $${PC_HOURLY_RATE}/hr = ~$${(draft.pcHours * draft.pcCleaners * PC_HOURLY_RATE).toFixed(0)}` : "",
      ].filter(Boolean).join("\n\n"),
      referralCode: draft.referralCode,
      afterPhotoConsent: draft.afterPhotoConsent,
      depositPaymentIntentId,
      stripeCustomerId: draft.stripeCustomerId,
      stripePaymentMethodId,
    });
    setSubmitting(false);
    if (!res.success) {
      submittingRef.current = false; // allow retry on error
      setSubmitError(res.error || "Something went wrong. Please try again.");
      return;
    }
    setConfirmedTotal(res.total ?? null);
    setSubmitted(true);
    // Keep submittingRef true after success — page transitions to confirmation
    // screen so further submits are impossible anyway.
  }

  // Live price for sidebar
  const isPC = draft.serviceType === "POST_CONSTRUCTION";
  const isAirbnb = draft.serviceType === "AIRBNB";
  const pcBase = draft.pcHours * draft.pcCleaners * PC_HOURLY_RATE;
  const effectiveBase = isPC ? pcBase : basePrice;

  const airbnbDiscountPct = isAirbnb
    ? (AIRBNB_FREQUENCIES.find((f) => f.value === draft.frequency)?.discount ?? 0)
    : 0;

  const addOnTotal = draft.addOns
    .filter((a) => a.selected)
    .reduce((s, a) => s + a.price, 0);
  const discountedBase = airbnbDiscountPct > 0
    ? effectiveBase * (1 - airbnbDiscountPct / 100)
    : effectiveBase;
  const subtotal = discountedBase + addOnTotal + draft.travelFee;
  const tax = calculateTax(subtotal);
  const showSummary = step >= 1 && (effectiveBase > 0);

  if (submitted) {
    return (
      <div className="cl-customer">
        <div
          style={{
            minHeight: "100vh",
            background:
              "linear-gradient(180deg, var(--cream) 0%, #fff 100%)",
          }}>
          <header
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              padding: "28px 48px",
              display: "flex",
              alignItems: "center",
              zIndex: 5,
            }}>
            <CustomerLogo />
          </header>
          <main
            style={{
              maxWidth: 720,
              margin: "0 auto",
              padding: "120px 32px 96px",
            }}>
            <div
              className="cl-fade-up"
              style={{ textAlign: "center" }}>
              <div
                style={{
                  width: 88,
                  height: 88,
                  borderRadius: "50%",
                  background: "var(--emerald-100)",
                  color: "var(--emerald-600)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 32,
                  boxShadow: "0 12px 32px rgba(16, 185, 129, 0.18)",
                }}>
                <Check size={42} strokeWidth={2.5} />
              </div>
              <p className="cl-eyebrow" style={{ marginBottom: 12 }}>
                Confirmed
              </p>
              <h1 className="cl-display" style={{ marginBottom: 18 }}>
                Thanks,
                <br />
                <em>{draft.name.split(/\s+/)[0]}!</em>
              </h1>
              <p
                className="cl-subtitle"
                style={{ maxWidth: 520, margin: "0 auto", fontSize: 16 }}>
                Your cleaning is scheduled for{" "}
                <strong style={{ color: "var(--ink)" }}>
                  {new Date(draft.date).toLocaleDateString("en-US", {
                    weekday: "long",
                  })}
                </strong>
                {draft.isFlexible
                  ? " (flexible — we'll confirm a time the day before)"
                  : ""}
                . We sent a confirmation to{" "}
                <strong style={{ color: "var(--ink)" }}>{draft.email}</strong>.
              </p>
              {confirmedTotal !== null ? (
                <p
                  style={{
                    fontSize: 14,
                    color: "var(--primary-70)",
                    maxWidth: 480,
                    margin: "24px auto 40px",
                  }}>
                  Total:{" "}
                  <strong
                    style={{
                      color: "var(--primary)",
                      fontFamily: "var(--font-cl-serif)",
                      fontSize: 20,
                    }}>
                    ${confirmedTotal.toFixed(2)} CAD
                  </strong>{" "}
                  — $20 deposit charged, remaining balance after cleaning.
                </p>
              ) : null}

              {isLoggedInClient ? (
                <>
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      justifyContent: "center",
                      flexWrap: "wrap",
                    }}>
                    <Link
                      href="/portal/bookings"
                      className="cl-btn cl-btn-primary cl-btn-lg">
                      View my bookings
                    </Link>
                    <Link
                      href="/portal"
                      className="cl-btn cl-btn-secondary cl-btn-lg">
                      Back to portal
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      justifyContent: "center",
                      flexWrap: "wrap",
                    }}>
                    <Link
                      href={`/portal/setup?email=${encodeURIComponent(
                        draft.email
                      )}&name=${encodeURIComponent(draft.name)}`}
                      className="cl-btn cl-btn-primary cl-btn-lg">
                      Set up my account
                    </Link>
                    <Link
                      href="/portal/login"
                      className="cl-btn cl-btn-secondary cl-btn-lg">
                      Back to home
                    </Link>
                  </div>
                  <div
                    style={{
                      marginTop: 24,
                      fontSize: 13,
                      color: "var(--primary-60)",
                    }}>
                    Already have an account?{" "}
                    <Link href="/portal/login" className="cl-link">
                      Log me in
                    </Link>
                  </div>
                </>
              )}
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="cl-customer">
      <div className="cl-book-shell">
        <aside className="cl-book-aside">
          <div className="cl-book-aside-logo">
            <span
              className="cl-logo-mark"
              style={{ background: "#fff", color: "var(--primary)" }}>
              <Sparkles size={18} strokeWidth={1.8} />
            </span>
            <span
              style={{
                color: "#fff",
                fontWeight: 600,
                fontSize: 18,
                letterSpacing: "-0.01em",
              }}>
              cleano
            </span>
          </div>

          <div className="cl-stack-8">
            <p
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: "rgba(255,255,255,0.55)",
                fontWeight: 600,
                margin: 0,
              }}>
              Book a cleaning
            </p>
            <h1
              style={{
                fontFamily: "var(--font-cl-serif)",
                fontSize: 30,
                color: "#fff",
                fontWeight: 300,
                letterSpacing: "-0.02em",
                lineHeight: 1.1,
                margin: 0,
              }}>
              Step {step + 1} of {STEP_LABELS.length}
            </h1>
          </div>

          <ol className="cl-vsteps" aria-label="Booking progress">
            {STEP_LABELS.map((label, i) => {
              const cls =
                i < step ? "cl-vstep done" : i === step ? "cl-vstep active" : "cl-vstep";
              return (
                <li key={label} className={cls}>
                  <span className="cl-vstep-dot">
                    {i < step ? <Check size={14} strokeWidth={2.4} /> : i + 1}
                  </span>
                  <div className="cl-vstep-meta">
                    <span className="cl-vstep-label">{label}</span>
                    <span className="cl-vstep-hint">{STEP_HINTS[i]}</span>
                  </div>
                </li>
              );
            })}
          </ol>

          {showSummary ? (
            <div className="cl-summary">
              <div className="cl-row-between">
                <span
                  style={{
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    color: "rgba(255,255,255,0.6)",
                    fontWeight: 600,
                  }}>
                  Estimate
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: "rgba(255,255,255,0.4)",
                  }}>
                  updates live
                </span>
              </div>
              <div className="cl-summary-row">
                <span>Base service</span>
                <strong>${effectiveBase.toFixed(2)}</strong>
              </div>
              {airbnbDiscountPct > 0 && (
                <div className="cl-summary-row" style={{ color: "#059669" }}>
                  <span>Airbnb discount (−{airbnbDiscountPct}%)</span>
                  <strong>−${(effectiveBase * airbnbDiscountPct / 100).toFixed(2)}</strong>
                </div>
              )}
              {addOnTotal > 0 ? (
                <div className="cl-summary-row">
                  <span>
                    {draft.addOns.filter((a) => a.selected).length} add-on
                    {draft.addOns.filter((a) => a.selected).length > 1
                      ? "s"
                      : ""}
                  </span>
                  <strong>${addOnTotal.toFixed(2)}</strong>
                </div>
              ) : null}
              {draft.travelFee > 0 ? (
                <div className="cl-summary-row">
                  <span>Travel fee</span>
                  <strong>${draft.travelFee.toFixed(2)}</strong>
                </div>
              ) : null}
              <div className="cl-summary-row">
                <span>Taxes (GST + QST)</span>
                <strong>${(tax.gstAmount + tax.qstAmount).toFixed(2)}</strong>
              </div>
              <div className="cl-summary-total">
                <span className="cl-summary-total-label">Total</span>
                <span className="cl-summary-total-value">
                  ${tax.total.toFixed(2)}
                </span>
              </div>
            </div>
          ) : null}

          <p
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.45)",
              lineHeight: 1.55,
              marginTop: "auto",
            }}>
            A $20 deposit is charged at booking. The remaining balance is due after your cleaning.
          </p>
        </aside>

        <main className="cl-book-main">
          <header className="cl-book-header">
            {isLoggedInClient && loggedInUser?.email ? (
              <Link
                href="/portal"
                className="cl-link"
                style={{ color: "var(--primary-70)" }}>
                Signed in as {loggedInUser.email} · Back to portal →
              </Link>
            ) : (
              <Link
                href="/portal/login"
                className="cl-link"
                style={{ color: "var(--primary-70)" }}>
                Already a customer? Sign in →
              </Link>
            )}
          </header>

          <div className="cl-book-body cl-fade-up">
            {step === 0 && (
              <Step1PostalCode
                draft={draft}
                onChange={patch}
                onContinue={() => setStep(1)}
              />
            )}
            {step === 1 && <Step2Property draft={draft} onChange={patch} />}
            {step === 2 && <Step3Schedule draft={draft} onChange={patch} />}
            {step === 3 && <Step4Contact draft={draft} onChange={patch} />}
            {step === 4 && (
              <>
                <Step5Review
                  draft={draft}
                  basePrice={basePrice}
                  onChange={patch}
                />
                <label
                  className="cl-check-row"
                  style={{ alignItems: "flex-start", marginTop: 24 }}>
                  <input
                    type="checkbox"
                    className="cl-check"
                    checked={draft.afterPhotoConsent}
                    onChange={(e) => patch({ afterPhotoConsent: e.target.checked })}
                    style={{ marginTop: 3 }}
                  />
                  <span
                    style={{
                      fontSize: 14,
                      lineHeight: 1.55,
                      color: "var(--ink-soft)",
                    }}>
                    {AFTER_PHOTO_CONSENT_TEXT}{" "}
                    <span style={{ color: "var(--primary-60)" }}>(optional)</span>
                  </span>
                </label>
                <label
                  className="cl-check-row"
                  style={{ alignItems: "flex-start", marginTop: 16 }}>
                  <input
                    type="checkbox"
                    className="cl-check"
                    checked={agree}
                    onChange={(e) => setAgree(e.target.checked)}
                    style={{ marginTop: 3 }}
                  />
                  <span
                    style={{
                      fontSize: 14,
                      lineHeight: 1.55,
                      color: "var(--ink-soft)",
                    }}>
                    I agree to Cleano's <a className="cl-link">terms of service</a> and
                    understand that prices may adjust after on-site assessment.
                  </span>
                </label>
              </>
            )}

            {submitError ? (
              <div style={{ marginTop: 24 }}>
                <Banner kind="error">{submitError}</Banner>
              </div>
            ) : null}

            {step > 0 ? (
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  marginTop: 40,
                  paddingTop: 24,
                  borderTop: "1px solid var(--primary-10)",
                }}>
                <Button variant="ghost" onClick={back}>
                  ← Back
                </Button>
                <div style={{ flex: 1 }}>
                  <Button
                    size="lg"
                    block
                    onClick={next}
                    loading={submitting}
                    disabled={!canProceed()}>
                    {step === 4
                      ? submitting
                        ? "Confirming…"
                        : "Confirm booking →"
                      : "Continue →"}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
