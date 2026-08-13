"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { BookingDraft, EMPTY_DRAFT } from "./types";
import Step1PostalCode from "./steps/Step1PostalCode";
import Step2Property from "./steps/Step2Property";
import Step3Schedule from "./steps/Step3Schedule";
import Step4Contact from "./steps/Step4Contact";
import Step5Review from "./steps/Step5Review";
import { saveLead } from "../actions/saveLead";
import { getQuote } from "../actions/getQuote";
import { submitBooking } from "../actions/submitBooking";
import { getBookingConfig } from "../actions/getBookingConfig";
import { getMyAddresses } from "../../(customer)/actions/clientAddresses";
import type { SavedAddress } from "@/lib/client-address";
import { calculateTax } from "@/lib/tax";
import { addOnLineTotal, sumAddOns } from "@/lib/job-money";
import { isValidEmail, isValidPhone } from "@/lib/validation";
import { AFTER_PHOTO_CONSENT_TEXT } from "@/lib/policy";
import {
  BOOKING_PAGE_DEFAULTS,
  frequencyEnabled,
  isFieldRequired,
  type BookingPageConfig,
} from "@/lib/booking-page-config";
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

const LAST_STEP = STEP_LABELS.length - 1;

/**
 * Where an in-progress booking is parked so browser Back — or a reload, or a
 * tab restore — doesn't throw the answers away.
 *
 * sessionStorage, not localStorage: this holds the customer's name, address,
 * email and phone, and it should die with the tab rather than sit on a shared
 * computer. The version suffix means a future change to BookingDraft can't
 * resurrect a stale shape.
 */
const DRAFT_STORAGE_KEY = "cleano.book.draft.v1";

interface StoredDraft {
  v: 1;
  step: number;
  draft: BookingDraft;
}

/**
 * What a given step requires before the wizard may move past it. Pure, and
 * module-level, so the same rule gates the Continue button, the browser's
 * Forward button, and a restored session — rather than the first of those
 * having a rule the other two can walk around.
 */
function stepRequirementsMet(
  s: number,
  draft: BookingDraft,
  agree: boolean,
  bookingPage: BookingPageConfig = BOOKING_PAGE_DEFAULTS
): boolean {
  switch (s) {
    case 0:
      return draft.postalCovered === true;
    case 1:
      if (!(draft.address.trim() && draft.serviceType && draft.frequency))
        return false;
      // Square footage gates Continue when the admin config marks it required
      // for this service. It is pinned required for Move-in/out, which is
      // priced per square foot and cannot be quoted without it.
      if (
        isFieldRequired(bookingPage, "property", "squareFootage", draft.serviceType) &&
        !(draft.squareFootage > 0)
      )
        return false;
      return true;
    case 2:
      return !!(
        draft.date &&
        (draft.isFlexible || (draft.timeSlot && draft.timeSlotValid !== false))
      );
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

/**
 * The furthest step a draft actually justifies being on: the first step whose
 * own requirements aren't met. Step 4's requirements (terms ticked, card ready)
 * gate submission, not arrival, so they are deliberately not consulted here.
 */
function maxReachableStep(
  draft: BookingDraft,
  agree: boolean,
  bookingPage: BookingPageConfig = BOOKING_PAGE_DEFAULTS
): number {
  for (let i = 0; i < LAST_STEP; i++) {
    if (!stepRequirementsMet(i, draft, agree, bookingPage)) return i;
  }
  return LAST_STEP;
}

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
  const [minInfo, setMinInfo] = useState<{ applied: boolean; min: number }>({
    applied: false,
    min: 0,
  });
  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmedTotal, setConfirmedTotal] = useState<number | null>(null);
  // Whether step 1 can offer "Back" to wherever the customer came from. Only
  // true when there IS somewhere to return to — a visitor who opened /book
  // directly gets no dead Back control, and we can't send them to "/" because
  // that's the authenticated portal, which would bounce them to login.
  const [canLeaveToReferrer, setCanLeaveToReferrer] = useState(false);
  useEffect(() => {
    setCanLeaveToReferrer(window.history.length > 1);
  }, []);
  const [minLeadDays, setMinLeadDays] = useState(1);
  // Per-service-category recurring discount table (item 7), for display.
  const [freqDiscounts, setFreqDiscounts] = useState<
    Record<string, Record<string, number>>
  >({});
  // "What's included" text + graphic per service type (item 3).
  const [serviceContent, setServiceContent] = useState<
    Record<string, { text: string; imageUrl: string }>
  >({});
  // Admin-editable booking-page layout (item 17). Starts on the shipped
  // defaults so the first paint matches what the admin config says anyway.
  const [bookingPage, setBookingPage] = useState<BookingPageConfig>(
    BOOKING_PAGE_DEFAULTS
  );

  // Hard guard against double-submit. The button is disabled while
  // `submitting` is true, but state updates are async so a fast double-click
  // could fire two requests. This ref blocks the second one synchronously.
  const submittingRef = useRef(false);

  // ── Draft persistence + history sync ──────────────────────────────────────
  // True once the restore pass has run, so the save effect can't write an empty
  // draft over a stored one on the very first render.
  const hydratedRef = useRef(false);
  // A restored draft's add-on selection AND quantity, replayed once the live
  // catalog loads (see below) so prices come from the server rather than from
  // storage. Keyed by catalog id, falling back to name.
  const restoredAddOnQtyRef = useRef<Map<string, number> | null>(null);
  // Suppresses the smsConsent default when the customer's own choice was
  // restored — a stored "unchecked" must not silently flip back to opted in.
  const restoredDraftRef = useRef(false);
  const stepRef = useRef(0);
  stepRef.current = step;

  // The signed-in customer's saved addresses, for the Step 2 picker (item 2).
  // Guests never fetch: the action returns [] without a session anyway, but not
  // calling it keeps the public flow free of a pointless round trip.
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  useEffect(() => {
    if (!isLoggedInClient) {
      setSavedAddresses([]);
      return;
    }
    let cancelled = false;
    getMyAddresses()
      .then((rows) => {
        if (!cancelled) setSavedAddresses(rows);
      })
      .catch(() => {
        // A failed lookup must not block booking — the free-text path stands.
        if (!cancelled) setSavedAddresses([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isLoggedInClient]);

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

  // Restore an interrupted booking, then lay down one history entry per step
  // already completed so browser Back walks back through the wizard instead of
  // leaving it. Runs once, before anything can write to storage.
  useEffect(() => {
    let restoredStep = 0;
    try {
      const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as StoredDraft | null;
        if (saved && saved.v === 1 && saved.draft) {
          const restoredDraft: BookingDraft = {
            ...EMPTY_DRAFT,
            ...saved.draft,
            // Re-fetched from the live catalog below, so a price that changed
            // while the tab sat idle can't be quoted from storage.
            addOns: [],
            // A restored session has no mounted Stripe Element, so nothing may
            // look like a card is ready to charge. The customer re-enters the
            // card (and re-ticks the terms box, which is never stored) before
            // Confirm can fire.
            stripeCardReady: false,
            stripeCustomerId: undefined,
          };
          // Key -> quantity, not just a list of keys: storing only "which were
          // selected" silently reset every quantity to 1 on reload/back-nav.
          restoredAddOnQtyRef.current = new Map(
            (saved.draft.addOns ?? [])
              .filter((a) => a.selected)
              .map((a) => [a.id ?? a.name, Math.max(1, a.quantity ?? 1)] as const)
          );
          restoredDraftRef.current = true;
          setDraft(restoredDraft);
          // The stored step is only a hint — it is checked against the stored
          // draft with the same rule that gates Continue, so nothing hand-edited
          // into storage can open a step the answers don't support. `agree` is
          // never stored, hence false.
          restoredStep = Math.min(
            Math.max(0, Math.floor(saved.step ?? 0)),
            maxReachableStep(restoredDraft, false)
          );
          setStep(restoredStep);
        }
      }
    } catch {
      // Storage unavailable or corrupt — start clean rather than break booking.
    }
    try {
      window.history.replaceState({ ...window.history.state, bookStep: 0 }, "");
      for (let i = 1; i <= restoredStep; i++) {
        window.history.pushState({ bookStep: i }, "");
      }
    } catch {
      /* ignore */
    }
    hydratedRef.current = true;
  }, []);

  // Replay a restored add-on selection (and its quantity) onto the freshly
  // loaded catalog. Prices deliberately still come from the live catalog.
  useEffect(() => {
    const qty = restoredAddOnQtyRef.current;
    if (!qty || draft.addOns.length === 0) return;
    restoredAddOnQtyRef.current = null;
    if (qty.size === 0) return;
    setDraft((d) => ({
      ...d,
      addOns: d.addOns.map((a) => {
        const q = qty.get(a.id ?? a.name);
        return q ? { ...a, selected: true, quantity: q } : a;
      }),
    }));
  }, [draft.addOns]);

  // Persist after every change. The draft is small, so this is a plain write
  // rather than another debounce to reason about.
  useEffect(() => {
    if (!hydratedRef.current || submitted) return;
    try {
      const payload: StoredDraft = {
        v: 1,
        step,
        // Never persist anything that could make a restored tab look
        // payment-ready.
        draft: { ...draft, stripeCardReady: false, stripeCustomerId: undefined },
      };
      sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* quota or private mode — persistence is a convenience, not a dependency */
    }
  }, [draft, step, submitted]);

  // A completed booking must not be restorable.
  useEffect(() => {
    if (!submitted) return;
    try {
      sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [submitted]);

  // Load admin-managed add-on catalog on first mount.
  useEffect(() => {
    let cancelled = false;
    getBookingConfig().then(({ addOns, minLeadDays, smsOptInDefault, frequencyDiscounts, serviceContent, bookingPage }) => {
      if (cancelled) return;
      setMinLeadDays(minLeadDays);
      setFreqDiscounts(frequencyDiscounts);
      setServiceContent(serviceContent);
      setBookingPage(bookingPage);
      // Only seed the default when this isn't a restored session — otherwise a
      // customer who deliberately opted out gets silently opted back in.
      if (!restoredDraftRef.current) {
        setDraft((d) => ({ ...d, smsConsent: smsOptInDefault }));
      }
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
                services: a.services,
                selected: false,
                quantity: 0,
                icon: a.icon,
                popupEnabled: a.popupEnabled,
                popupTitle: a.popupTitle,
                popupMessage: a.popupMessage,
                popupRequestPhoto: a.popupRequestPhoto,
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
      aptNumber: draft.aptNumber,
      addressId: draft.addressId,
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

  // Live quote refresh on Property/Review steps. Server-authoritative for every
  // service type (bed/bath, sqft for move-in/out, hourly/package for PC).
  useEffect(() => {
    if (step < 1) return;
    getQuote({
      serviceType: draft.serviceType,
      bedCount: draft.bedCount,
      bathCount: draft.bathCount,
      halfBathCount: draft.halfBathCount,
      squareFootage: draft.squareFootage,
      pcHours: draft.pcHours,
      pcCleaners: draft.pcCleaners,
    })
      .then((r) => {
        if (r.success && "basePrice" in r && typeof r.basePrice === "number") {
          setBasePrice(r.basePrice);
          setMinInfo({
            applied: !!r.minApplied,
            min: r.minJobPrice ?? 0,
          });
        } else {
          // Quote failed / returned no price — clear stale price + "minimum
          // applied" so the sidebar doesn't keep showing a previous service's
          // numbers.
          setBasePrice(0);
          setMinInfo({ applied: false, min: 0 });
        }
      })
      .catch(() => {
        setBasePrice(0);
        setMinInfo({ applied: false, min: 0 });
      });
  }, [
    step,
    draft.serviceType,
    draft.bedCount,
    draft.bathCount,
    draft.halfBathCount,
    draft.squareFootage,
    draft.pcHours,
    draft.pcCleaners,
  ]);

  function patch(p: Partial<BookingDraft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  // Item 15: a service with no frequency choice is a one-off price with no
  // recurring discount. Selecting the service already resets the frequency, but
  // a restored draft — or an admin turning the field off after the fact — could
  // still be carrying a recurring value, which would quote a discount the form
  // never offered. `submitBooking` enforces the same rule server-side.
  useEffect(() => {
    if (
      draft.frequency !== "ONE_TIME" &&
      !frequencyEnabled(bookingPage, draft.serviceType)
    ) {
      setDraft((d) => ({ ...d, frequency: "ONE_TIME" }));
    }
  }, [bookingPage, draft.serviceType, draft.frequency]);

  function canProceedFrom(s: number): boolean {
    return stepRequirementsMet(s, draft, agree, bookingPage);
  }

  function canProceed(): boolean {
    return canProceedFrom(step);
  }

  // Read by the popstate listener, which is registered once and would otherwise
  // close over a stale draft.
  const maxReachableRef = useRef(0);
  maxReachableRef.current = maxReachableStep(draft, agree, bookingPage);

  /** Forward one step: a new history entry, so Back returns here. */
  function advanceTo(n: number) {
    try {
      window.history.pushState({ bookStep: n }, "");
    } catch {
      /* ignore */
    }
    setStep(n);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /**
   * Backwards: pop the history instead of setting state, so the wizard's own
   * Back control and the browser's are the same action and can't disagree
   * about where the stack is. Falls back to plain state if the current entry
   * isn't one of ours (then the button still works).
   */
  function retreatTo(n: number) {
    const from = stepRef.current;
    if (n >= from) return;
    const ours = (window.history.state as { bookStep?: number } | null)?.bookStep;
    if (typeof ours === "number") {
      window.history.go(n - from);
      return;
    }
    setStep(n);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Browser Back / Forward drive the wizard rather than leaving it.
  useEffect(() => {
    function onPopState(e: PopStateEvent) {
      const target = (e.state as { bookStep?: number } | null)?.bookStep;
      if (typeof target !== "number") return; // not ours — let it navigate

      // Mid-payment: the deposit confirmation is already in flight and the
      // booking may be moments from existing. Stay put and put the entry back.
      if (submittingRef.current) {
        try {
          window.history.pushState({ bookStep: stepRef.current }, "");
        } catch {
          /* ignore */
        }
        return;
      }

      const clamped = Math.max(0, Math.min(target, maxReachableRef.current));
      if (clamped !== target) {
        // Refused to open the step the entry asked for (an answer it depends on
        // has since been cleared). Relabel the entry we're on so the stack never
        // claims a step that isn't the one being shown.
        try {
          window.history.replaceState({ bookStep: clamped }, "");
        } catch {
          /* ignore */
        }
      }
      setStep(clamped);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function next() {
    if (!canProceed()) return;
    if (step === LAST_STEP) {
      handleSubmit();
      return;
    }
    advanceTo(step + 1);
  }
  function back() {
    retreatTo(Math.max(0, step - 1));
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

    // The card form registers this. If it never mounted (Stripe failed to
    // load), we must NOT fall through and submit — the server now requires a
    // verified deposit and would reject with a generic message, so fail here
    // with something the customer can act on.
    if (!confirmFn) {
      setSubmitError(
        "The payment form didn't load. Please refresh the page and try again."
      );
      setSubmitting(false);
      submittingRef.current = false;
      return;
    }

    const depositResult = await confirmFn();
    if (!depositResult) {
      setSubmitError("Payment failed. Please check your card details and try again.");
      setSubmitting(false);
      submittingRef.current = false;
      return;
    }
    depositPaymentIntentId = depositResult.paymentIntentId;

    const res = await submitBooking({
      postalCode: draft.postalCode,
      address: draft.address,
      bedCount: draft.bedCount,
      bathCount: draft.bathCount,
      halfBathCount: draft.halfBathCount,
      squareFootage: draft.squareFootage,
      serviceType: draft.serviceType,
      pcHours: draft.pcHours,
      pcCleaners: draft.pcCleaners,
      frequency: draft.frequency,
      addOns: draft.addOns
        .filter((a) => a.selected)
        .map((a) => ({ id: a.id, name: a.name, quantity: a.quantity })),
      date: draft.date,
      isFlexible: draft.isFlexible,
      timeSlot: draft.timeSlot,
      name: draft.name,
      phone: draft.phone,
      email: draft.email,
      notes: [
        draft.notes,
        isPC
          ? `Post-construction: ${draft.pcHours} hour(s)${
              draft.pcCleaners ? `, ${draft.pcCleaners} cleaner(s)` : ""
            }`
          : "",
      ].filter(Boolean).join("\n\n"),
      referralCode: draft.referralCode,
      // The code only — never the discount figure. The server re-validates it
      // against the catalog and re-derives the amount from its own subtotal.
      promoCode: draft.promoCode,
      afterPhotoConsent: draft.afterPhotoConsent,
      smsConsent: draft.smsConsent,
      // The Stripe customer and payment-method ids are intentionally not sent:
      // the server reads them off the verified PaymentIntent instead.
      depositPaymentIntentId,
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

  // Live price for sidebar. basePrice is server-computed for every service type.
  const isPC = draft.serviceType === "POST_CONSTRUCTION";
  const isAirbnb = draft.serviceType === "AIRBNB";
  const effectiveBase = basePrice;

  // Airbnb turnover discounts apply to every visit and are admin-configurable
  // (item 7). Read from the AIRBNB category of the pricing config — the only
  // source; the frequency LABELS are admin-editable copy and carry no money.
  const airbnbDiscountPct = isAirbnb
    ? (freqDiscounts.AIRBNB?.[draft.frequency] ?? 0)
    : 0;

  const selectedAddOns = draft.addOns.filter((a) => a.selected);
  const addOnTotal = sumAddOns(selectedAddOns);
  const discountedBase = airbnbDiscountPct > 0
    ? effectiveBase * (1 - airbnbDiscountPct / 100)
    : effectiveBase;
  // A validated promo comes off before tax, matching Step 5 and the server, so
  // the live estimate can't sit next to the review card showing a different
  // total for the same booking.
  const grossSubtotal = discountedBase + addOnTotal + draft.travelFee;
  const promoDiscount =
    draft.promoApplied && draft.promoDiscount
      ? Math.min(draft.promoDiscount, grossSubtotal)
      : 0;
  const subtotal = grossSubtotal - promoDiscount;
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
                      href="/bookings"
                      className="cl-btn cl-btn-primary cl-btn-lg">
                      View my bookings
                    </Link>
                    <Link
                      href="/"
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
                      href={`/setup?email=${encodeURIComponent(
                        draft.email
                      )}&name=${encodeURIComponent(draft.name)}`}
                      className="cl-btn cl-btn-primary cl-btn-lg">
                      Set up my account
                    </Link>
                    <Link
                      href="/login"
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
                    <Link href="/login" className="cl-link">
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
              // Completed steps are clickable shortcuts back. Only backwards —
              // jumping forward would skip the per-step validation that gates
              // Next, so it could reach review with an incomplete draft.
              const canJump = i < step && !submitting;
              const dot = (
                <>
                  <span className="cl-vstep-dot">
                    {i < step ? <Check size={14} strokeWidth={2.4} /> : i + 1}
                  </span>
                  <div className="cl-vstep-meta">
                    <span className="cl-vstep-label">{label}</span>
                    <span className="cl-vstep-hint">{STEP_HINTS[i]}</span>
                  </div>
                </>
              );
              return (
                <li key={label} className={cls}>
                  {canJump ? (
                    <button
                      type="button"
                      onClick={() => retreatTo(i)}
                      aria-label={`Back to step ${i + 1}: ${label}`}
                      style={{
                        display: "contents",
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        textAlign: "left",
                        font: "inherit",
                        color: "inherit",
                      }}>
                      {dot}
                    </button>
                  ) : (
                    dot
                  )}
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
                <span>Base service{minInfo.applied ? " (minimum)" : ""}</span>
                <strong>${effectiveBase.toFixed(2)}</strong>
              </div>
              {minInfo.applied && minInfo.min > 0 && (
                <div
                  className="cl-summary-row"
                  style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
                  <span>Minimum charge of ${minInfo.min.toFixed(2)} applied</span>
                </div>
              )}
              {airbnbDiscountPct > 0 && (
                <div className="cl-summary-row" style={{ color: "#059669" }}>
                  <span>Airbnb discount (−{airbnbDiscountPct}%)</span>
                  <strong>−${(effectiveBase * airbnbDiscountPct / 100).toFixed(2)}</strong>
                </div>
              )}
              {/* One row per add-on rather than a count: "2 add-ons" is
                  ambiguous once quantities exist (2 windows at qty 3 is not
                  "2 add-ons" worth of money). */}
              {selectedAddOns.map((a, i) => (
                <div className="cl-summary-row" key={a.id ?? `${a.name}-${i}`}>
                  <span>
                    {a.name}
                    {a.quantity > 1 ? ` ×${a.quantity}` : ""}
                  </span>
                  <strong>${addOnLineTotal(a).toFixed(2)}</strong>
                </div>
              ))}
              {draft.travelFee > 0 ? (
                <div className="cl-summary-row">
                  <span>Travel fee</span>
                  <strong>${draft.travelFee.toFixed(2)}</strong>
                </div>
              ) : null}
              {promoDiscount > 0 ? (
                <div className="cl-summary-row" style={{ color: "#059669" }}>
                  <span>Promo ({draft.promoCode})</span>
                  <strong>−${promoDiscount.toFixed(2)}</strong>
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
                href="/"
                className="cl-link"
                style={{ color: "var(--primary-70)" }}>
                Signed in as {loggedInUser.email} · Back to portal →
              </Link>
            ) : (
              <Link
                href="/login"
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
                onContinue={() => advanceTo(1)}
                bookingPage={bookingPage}
              />
            )}
            {step === 1 && (
              <Step2Property
                draft={draft}
                onChange={patch}
                savedAddresses={savedAddresses}
                basePrice={basePrice}
                freqDiscounts={freqDiscounts}
                serviceContent={serviceContent}
                bookingPage={bookingPage}
              />
            )}
            {step === 2 && (
              <Step3Schedule
                draft={draft}
                onChange={patch}
                minLeadDays={minLeadDays}
                bookingPage={bookingPage}
              />
            )}
            {step === 3 && (
              <Step4Contact
                draft={draft}
                onChange={patch}
                bookingPage={bookingPage}
              />
            )}
            {step === 4 && (
              <>
                <Step5Review
                  draft={draft}
                  basePrice={basePrice}
                  onChange={patch}
                  freqDiscounts={freqDiscounts}
                  bookingPage={bookingPage}
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
            ) : canLeaveToReferrer ? (
              // Step 1 has its own Continue button inside the step, so this row
              // carries only Back — returning the customer to wherever they came
              // from rather than stranding them at the start of the flow.
              <div
                style={{
                  display: "flex",
                  marginTop: 40,
                  paddingTop: 24,
                  borderTop: "1px solid var(--primary-10)",
                }}>
                <Button variant="ghost" onClick={() => window.history.back()}>
                  ← Back
                </Button>
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
