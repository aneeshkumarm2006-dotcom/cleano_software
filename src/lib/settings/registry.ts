/**
 * Central registry of admin-editable settings — the "settings spine".
 *
 * Each entry defines a setting's storage key, the admin tab (category) it
 * surfaces under, its type, a default value, a validator, and audit flags.
 *
 * RULE: every `default` MUST equal the value currently hardcoded in the code
 * it replaces. Until an admin edits a setting there is no `AppSetting` row, so
 * readers fall back to the default and behavior is byte-for-byte unchanged.
 *
 * This module is intentionally free of server-only imports so the admin UI can
 * read labels/defaults from it. All persistence lives in `@/lib/settings`.
 */

import {
  DEFAULT_JOB_TYPE_LABELS,
  normaliseLabelMap,
  type PriorityLabel,
} from "@/lib/calendar-labels";
import {
  BOOKING_PAGE_CONFIG_KEY,
  BOOKING_PAGE_DEFAULTS,
  normalizeBookingPageConfig,
  type BookingPageConfig,
} from "@/lib/booking-page-config";
import {
  QUOTE_PAGE_CONFIG_KEY,
  QUOTE_PAGE_DEFAULTS,
  normalizeQuotePageConfig,
  type QuotePageConfig,
} from "@/lib/quote-page-config";
import {
  PC_DEPOSIT_DEFAULT_USD,
  PC_DEPOSIT_MAX_USD,
  PC_DEPOSIT_MIN_USD,
  PC_DEPOSIT_SETTING_KEY,
  STANDARD_BOOKING_DEPOSIT_USD,
  STANDARD_DEPOSIT_MAX_USD,
  STANDARD_DEPOSIT_MIN_USD,
  STANDARD_DEPOSIT_SETTING_KEY,
} from "@/lib/booking-deposit";

export type SettingCategory =
  | "account"
  | "general"
  | "bookings"
  | "customer"
  | "provider"
  | "scheduling"
  | "payments"
  | "notifications"
  | "website";

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface SettingDef<T> {
  /** Unique AppSetting.key, dotted namespace (e.g. "policy.cancellationFeeUsd"). */
  key: string;
  /** Admin tab this setting belongs to; stored in AppSetting.category. */
  category: SettingCategory;
  /** Short human label for the admin UI. */
  label: string;
  /** Default — equals the current hardcoded value; returned when no row exists. */
  default: T;
  /** Parse + validate a raw stored/incoming value. */
  validate: (v: unknown) => ValidationResult<T>;
  /** Write an audit-log row on every change. */
  audit?: boolean;
  /** Money/charge-affecting — always audited and flagged for extra review. */
  sensitive?: boolean;
}

/* ------------------------------- validators ------------------------------- */

function intRange(min: number, max: number) {
  return (v: unknown): ValidationResult<number> => {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return { ok: false, error: "Must be a number" };
    if (!Number.isInteger(n))
      return { ok: false, error: "Must be a whole number" };
    if (n < min || n > max)
      return { ok: false, error: `Must be between ${min} and ${max}` };
    return { ok: true, value: n };
  };
}

function moneyRange(min: number, max: number) {
  return (v: unknown): ValidationResult<number> => {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return { ok: false, error: "Must be a number" };
    if (n < min || n > max)
      return { ok: false, error: `Must be between $${min} and $${max}` };
    return { ok: true, value: Math.round(n * 100) / 100 };
  };
}

function bool() {
  return (v: unknown): ValidationResult<boolean> => {
    if (typeof v === "boolean") return { ok: true, value: v };
    if (v === "true") return { ok: true, value: true };
    if (v === "false") return { ok: true, value: false };
    return { ok: false, error: "Must be true or false" };
  };
}

/** Non-empty, strictly-ascending list of whole-dollar amounts (e.g. gift-card tiers). */
function ascendingAmounts(min: number, max: number) {
  return (v: unknown): ValidationResult<number[]> => {
    if (!Array.isArray(v) || v.length === 0)
      return { ok: false, error: "Provide at least one amount" };
    const nums = v.map((x) => (typeof x === "number" ? x : Number(x)));
    if (nums.some((n) => !Number.isFinite(n) || n < min || n > max))
      return {
        ok: false,
        error: `Each amount must be between $${min} and $${max}`,
      };
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] <= nums[i - 1])
        return { ok: false, error: "Amounts must be in ascending order" };
    }
    return { ok: true, value: nums.map((n) => Math.round(n)) };
  };
}

function currency() {
  return (v: unknown): ValidationResult<string> => {
    if (v === "CAD" || v === "USD") return { ok: true, value: v };
    return { ok: false, error: "Must be CAD or USD" };
  };
}

/** Supported store timezones (IANA), labelled for the admin dropdown. */
export const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "America/Toronto", label: "Eastern — Toronto / Montréal" },
  { value: "America/Halifax", label: "Atlantic — Halifax" },
  { value: "America/St_Johns", label: "Newfoundland — St. John's" },
  { value: "America/Winnipeg", label: "Central — Winnipeg" },
  { value: "America/Regina", label: "Saskatchewan — Regina" },
  { value: "America/Edmonton", label: "Mountain — Edmonton / Calgary" },
  { value: "America/Vancouver", label: "Pacific — Vancouver" },
];

function timezone() {
  const allowed = new Set(TIMEZONE_OPTIONS.map((t) => t.value));
  return (v: unknown): ValidationResult<string> => {
    if (typeof v === "string" && allowed.has(v)) return { ok: true, value: v };
    return { ok: false, error: "Pick a supported timezone" };
  };
}

/** Non-empty trimmed string (e.g. a customer-facing message). */
function text(maxLen = 500) {
  return (v: unknown): ValidationResult<string> => {
    if (typeof v !== "string") return { ok: false, error: "Must be text" };
    const s = v.trim();
    if (s.length === 0) return { ok: false, error: "Cannot be empty" };
    if (s.length > maxLen)
      return { ok: false, error: `Must be ${maxLen} characters or fewer` };
    return { ok: true, value: s };
  };
}

/** A contact email address. */
function email() {
  return (v: unknown): ValidationResult<string> => {
    if (typeof v !== "string") return { ok: false, error: "Must be text" };
    const s = v.trim();
    if (s.length === 0) return { ok: false, error: "Cannot be empty" };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
      return { ok: false, error: "Enter a valid email address" };
    return { ok: true, value: s };
  };
}

/** List of {question, answer} pairs (FAQ entries). Empty list is allowed. */
function faqList() {
  return (
    v: unknown
  ): ValidationResult<{ question: string; answer: string }[]> => {
    if (!Array.isArray(v)) return { ok: false, error: "Provide a list" };
    const items = v
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map((x) => ({
        question: typeof x.question === "string" ? x.question.trim() : "",
        answer: typeof x.answer === "string" ? x.answer.trim() : "",
      }))
      .filter((x) => x.question.length > 0 && x.answer.length > 0);
    return { ok: true, value: items };
  };
}

/** Non-empty list of trimmed, non-blank strings (e.g. dropdown options). */
function stringList(maxLen = 80) {
  return (v: unknown): ValidationResult<string[]> => {
    if (!Array.isArray(v)) return { ok: false, error: "Provide a list" };
    const items = v
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter((s) => s.length > 0);
    if (items.length === 0)
      return { ok: false, error: "Provide at least one option" };
    if (items.some((s) => s.length > maxLen))
      return { ok: false, error: `Each option must be ${maxLen} characters or fewer` };
    return { ok: true, value: items };
  };
}

/** Public booking-flow field config (show/hide, order, labels, help text). */
function bookingPageConfig() {
  return (v: unknown): ValidationResult<BookingPageConfig> => {
    // The normalizer is total — unknown field keys are dropped, missing ones
    // fall back to their default — so there is no invalid value to reject.
    return { ok: true, value: normalizeBookingPageConfig(v) };
  };
}

/** Public quote-page copy + field config (show/hide, order, labels, required). */
function quotePageConfig() {
  return (v: unknown): ValidationResult<QuotePageConfig> => {
    // Total normalizer, same as the booking page: unknown field keys are
    // dropped and missing ones fall back to their default, so there is no
    // invalid value to reject.
    return { ok: true, value: normalizeQuotePageConfig(v) };
  };
}

/** Service-type -> calendar priority label ("ROUTINE"|"IMPORTANT"|"NONE") map. */
function jobTypeLabelMap() {
  return (v: unknown): ValidationResult<Record<string, PriorityLabel>> => {
    if (!v || typeof v !== "object" || Array.isArray(v))
      return { ok: false, error: "Provide a mapping" };
    return { ok: true, value: normaliseLabelMap(v) };
  };
}

/** Identity helper so each entry's generic `T` is inferred from `default`. */
function def<T>(d: SettingDef<T>): SettingDef<T> {
  return d;
}

/* -------------------------------- registry -------------------------------- */
//
// Phase 1 (Bucket B) settings. Defaults verified against source:
//   policy.ts → CANCELLATION_FEE_USD=20, CANCELLATION_FEE_WINDOW_HOURS=48,
//               NO_SHOW_FEE_USD=25, ON_THE_WAY_ETA_MIN=15,
//               ACCEPT_DECLINE_TIMEOUT_MIN=10, LATE_PENALTY_GRACE_MIN=10
//   referral.ts → NEW_CLIENT_DISCOUNT=15, REFERRER_CREDIT=10 (those constants
//                 have since been deleted; these keys are now the only source)
//
// More settings (gift-card min/tiers, provider pay %, currency/timezone) are
// added in their own PRs once each current value is verified at its source.

export const SETTINGS = {
  "policy.cancellationFeeUsd": def({
    key: "policy.cancellationFeeUsd",
    category: "payments",
    label: "Late-cancellation fee ($)",
    default: 20,
    validate: moneyRange(0, 500),
    audit: true,
    sensitive: true,
  }),
  "policy.cancellationFeeWindowHours": def({
    key: "policy.cancellationFeeWindowHours",
    category: "payments",
    label: "Late-cancellation window (hours)",
    default: 48,
    validate: intRange(0, 168),
    audit: true,
  }),
  "scheduling.noShowFeeUsd": def({
    key: "scheduling.noShowFeeUsd",
    category: "scheduling",
    label: "No-show fee ($)",
    default: 25,
    validate: moneyRange(0, 500),
    audit: true,
    sensitive: true,
  }),
  "scheduling.onTheWayEtaMin": def({
    key: "scheduling.onTheWayEtaMin",
    category: "scheduling",
    label: "On-the-way notification ETA (minutes)",
    default: 15,
    validate: intRange(1, 240),
  }),
  "scheduling.acceptDeclineTimeoutMin": def({
    key: "scheduling.acceptDeclineTimeoutMin",
    category: "scheduling",
    label: "Cleaner accept/decline timeout (minutes)",
    default: 10,
    validate: intRange(1, 240),
  }),
  "scheduling.latePenaltyGraceMin": def({
    key: "scheduling.latePenaltyGraceMin",
    category: "scheduling",
    label: "Late-arrival grace period (minutes)",
    default: 10,
    validate: intRange(0, 240),
  }),
  // Live GPS tracking (#10): when on, the cleaner's device shares its location
  // between "On my way" and clock-in, and admins see a live map on the job.
  // When off, no location is captured, no map/polling, and no geolocation
  // prompt — only the plain "On the way" status remains. Default true =
  // current behavior.
  "tracking.gpsEnabled": def({
    key: "tracking.gpsEnabled",
    category: "scheduling",
    label: "Live GPS tracking — show cleaner location to admin while on the way",
    default: true,
    validate: bool(),
  }),
  "customer.newClientReferralDiscountUsd": def({
    key: "customer.newClientReferralDiscountUsd",
    category: "customer",
    label: "New-client referral discount ($)",
    default: 15,
    validate: moneyRange(0, 200),
    audit: true,
    sensitive: true,
  }),
  "customer.referrerCreditUsd": def({
    key: "customer.referrerCreditUsd",
    category: "customer",
    label: "Referrer credit ($)",
    default: 10,
    validate: moneyRange(0, 200),
    audit: true,
    sensitive: true,
  }),
  // Single-use coupon a customer unlocks by sharing Cleano on social media
  // (Facebook / X). $15 off per spec (#92-94).
  "customer.shareCouponUsd": def({
    key: "customer.shareCouponUsd",
    category: "customer",
    label: "Social-share coupon ($)",
    default: 15,
    validate: moneyRange(0, 200),
    audit: true,
    sensitive: true,
  }),
  "customer.smsOptInDefault": def({
    key: "customer.smsOptInDefault",
    category: "customer",
    label: "SMS notifications opt-in checked by default",
    default: true,
    validate: bool(),
  }),
  // Shown full-screen when a deactivated customer (Client.isActive = false)
  // opens their portal. Editable, customer-facing.
  "customer.blockedMessage": def({
    key: "customer.blockedMessage",
    category: "customer",
    label: "Message shown to a blocked customer",
    default:
      "We apologize for the inconvenience. Please contact our office if you have any questions.",
    validate: text(500),
  }),
  // Public "live reviews" wall at /reviews — social proof to lift conversions.
  "customer.liveReviewsEnabled": def({
    key: "customer.liveReviewsEnabled",
    category: "customer",
    label: "Show live reviews page (/reviews)",
    default: true,
    validate: bool(),
  }),
  // Only ratings at or above this star value (with a written note) appear.
  "customer.liveReviewThreshold": def({
    key: "customer.liveReviewThreshold",
    category: "customer",
    label: "Minimum stars for a live review",
    default: 5,
    validate: intRange(1, 5),
  }),
  // Only show an assigned cleaner's star rating to the customer when their
  // average is at or above this (#66). Hides low/unproven ratings.
  "customer.providerRatingThreshold": def({
    key: "customer.providerRatingThreshold",
    category: "customer",
    label: "Minimum stars to show a cleaner's rating to customers",
    default: 4,
    validate: intRange(1, 5),
  }),
  // Reasons a customer picks from when cancelling. Shown as a required
  // dropdown in the portal cancel modal; the choice is logged on the job.
  "customer.cancellationReasons": def({
    key: "customer.cancellationReasons",
    category: "customer",
    label: "Cancellation reasons (one per line)",
    default: [
      "Schedule conflict",
      "No longer needed",
      "Found another provider",
      "Too expensive",
      "Not satisfied",
      "Other",
    ],
    validate: stringList(80),
  }),
  // How many additional recurring occurrences to auto-create for the
  // weekly-cadence frequencies. Default 3 = current behavior (see
  // recurrenceCount in booking-pricing.ts).
  "scheduling.recurringWeeklyHorizon": def({
    key: "scheduling.recurringWeeklyHorizon",
    category: "scheduling",
    label: "Recurring bookings created ahead (weekly cadence)",
    default: 3,
    validate: intRange(0, 52),
  }),
  // Minimum days ahead a customer can book. Default 1 = current behavior
  // (the booking date picker's earliest date is tomorrow). Set to 2 to match
  // the spec's "no same-day, 2-day cutoff".
  "scheduling.minLeadDays": def({
    key: "scheduling.minLeadDays",
    category: "scheduling",
    label: "Minimum days before a booking (lead time)",
    default: 1,
    validate: intRange(0, 30),
  }),
  // Whether the assigned cleaner can see the customer's phone number on the
  // job. Default true = current behavior. Email/price visibility are handled
  // separately (price is a pending product decision).
  "provider.showCustomerPhone": def({
    key: "provider.showCustomerPhone",
    category: "provider",
    label: "Cleaners can see the customer's phone number",
    default: true,
    validate: bool(),
  }),
  // Shown full-screen when a deactivated cleaner (User.isActive = false) opens
  // the app. Editable, provider-facing.
  "provider.deactivatedMessage": def({
    key: "provider.deactivatedMessage",
    category: "provider",
    label: "Message shown to a deactivated cleaner",
    default:
      "We apologize for the inconvenience. Please contact our office if you have any questions.",
    validate: text(500),
  }),
  // Fallback refill threshold for a cleaner's assigned stock when the product
  // carries no `cleanerRestockThreshold` of its own. That column defaults to 0,
  // which made "low" unreachable — a cleaner was only ever warned AT zero. With
  // a non-zero floor, "Running low" fires BEFORE the item runs out.
  //
  // Since the Inventory Rules settings were removed (awerfixes.pdf item 14),
  // this and the per-product column are the ONLY two inputs to
  // `cleanerRestockThreshold()` — there is no longer a usage-derived floor
  // quietly raising it behind the admin's back.
  "inventory.defaultRefillThreshold": def({
    key: "inventory.defaultRefillThreshold",
    category: "provider",
    label: "Default refill threshold for cleaner supplies (units)",
    default: 2,
    validate: intRange(0, 1000),
  }),
  // Gift-card purchase tiers. Default drops the old $100 tier so the minimum
  // purchase is $150 (client decision, 2026-06). Lowest tier = the minimum.
  "payments.giftCardTiers": def({
    key: "payments.giftCardTiers",
    category: "payments",
    label: "Gift card purchase amounts ($)",
    default: [150, 200, 250, 300, 350, 400],
    validate: ascendingAmounts(1, 100_000),
    audit: true,
  }),
  // Store currency. The app already charges in CAD via Stripe; this surfaces
  // it as an admin setting and is the source for any future money formatting.
  "general.currency": def({
    key: "general.currency",
    category: "general",
    label: "Store currency",
    default: "CAD",
    validate: currency(),
    audit: true,
  }),
  // Store timezone (IANA). Currently governs booking lead-time cut-offs;
  // the source of truth for date/time handling going forward. Default matches
  // the previously hardcoded "America/Toronto".
  "general.timezone": def({
    key: "general.timezone",
    category: "general",
    label: "Time zone",
    default: "America/Toronto",
    validate: timezone(),
    audit: true,
  }),
  // Public-facing business name. Shown in the marketing site header/footer.
  // Default = the brand name currently hardcoded there.
  "general.businessName": def({
    key: "general.businessName",
    category: "general",
    label: "Business name",
    default: "Cleano",
    validate: text(80),
    audit: true,
  }),
  // Customer-facing contact email. Shown in the portal "Need help?" tiles.
  // Default = the value currently hardcoded in those tiles.
  "general.businessEmail": def({
    key: "general.businessEmail",
    category: "general",
    label: "Contact email",
    default: "care@cleano.ca",
    validate: email(),
    audit: true,
  }),
  // Customer-facing contact phone. Shown in the portal "Need help?" tiles.
  // Default = the value currently hardcoded in those tiles.
  "general.businessPhone": def({
    key: "general.businessPhone",
    category: "general",
    label: "Contact phone",
    default: "(514) 555-CLEAN",
    validate: text(40),
    audit: true,
  }),
  // Public FAQ entries, rendered at /faq. Admin-managed; no migration.
  "content.faqs": def({
    key: "content.faqs",
    category: "website",
    label: "Frequently asked questions",
    default: [
      {
        question: "What areas do you serve?",
        answer:
          "We serve the Greater Montreal area. Enter your postal code on the booking page to confirm coverage.",
      },
      {
        question: "How do I reschedule or cancel?",
        answer:
          "You can request a reschedule or cancellation from your customer portal. Cancellations close to your appointment may incur a fee.",
      },
    ],
    validate: faqList(),
    // The editor tells admins "Changes are audit-logged"; without this flag the
    // settings spine skips the ActivityLog write and that promise was false.
    audit: true,
  }),
  // Calendar priority badges: which service type gets "R" (Routine, blue) or
  // "I" (Important, yellow) in the top-left of a booking. Admin-editable in
  // Settings → Calendar Labels; per-job overrides live on Job.priorityLabel.
  "calendar.jobTypeLabels": def({
    key: "calendar.jobTypeLabels",
    category: "scheduling",
    label: "Calendar priority labels by service type",
    default: DEFAULT_JOB_TYPE_LABELS,
    validate: jobTypeLabelMap(),
  }),
  // Public booking flow (/book): which fields show, in what order, with what
  // labels and help text — per service type. Item 17: the client wanted this
  // class of change to stop being a code request. Defaults live in
  // @/lib/booking-page-config and match what /book renders.
  [BOOKING_PAGE_CONFIG_KEY]: def({
    key: BOOKING_PAGE_CONFIG_KEY,
    category: "bookings",
    label: "Booking page fields",
    default: BOOKING_PAGE_DEFAULTS,
    validate: bookingPageConfig(),
    audit: true,
  }),
  // Post-construction deposit (PDF #9, Stage 11). The ONE deposit amount that is
  // configurable: PDF #9 asks for an upfront deposit on post-construction
  // ("example: $200") and says regular bookings keep their $20, so the standard
  // deposit deliberately stays the constant in @/lib/booking-deposit rather than
  // becoming a second money setting nobody asked for.
  //
  // `sensitive` because this is charged to a customer's card before anyone has
  // seen the space. The upper bound in the validator is a fat-finger guard, not a
  // policy: a mistyped 20000 must be refused here rather than by a chargeback.
  // The deposit every non-quoted booking charges. Hardcoded at $20 while one
  // company used the product; $20 is a fair hold on a small flat and nothing at
  // all on a large job, and every company prices differently.
  //
  // Zero is permitted and is a real decision, not a neutral one: in the guest
  // flow the captured deposit is what stops a stranger minting unlimited real
  // jobs from the public page. The label says so.
  [STANDARD_DEPOSIT_SETTING_KEY]: def({
    key: STANDARD_DEPOSIT_SETTING_KEY,
    category: "bookings",
    label: "Booking deposit ($) — 0 takes bookings with no deposit and no card",
    default: STANDARD_BOOKING_DEPOSIT_USD,
    validate: moneyRange(STANDARD_DEPOSIT_MIN_USD, STANDARD_DEPOSIT_MAX_USD),
    audit: true,
    sensitive: true,
  }),
  [PC_DEPOSIT_SETTING_KEY]: def({
    key: PC_DEPOSIT_SETTING_KEY,
    category: "bookings",
    label: "Post-construction deposit ($)",
    default: PC_DEPOSIT_DEFAULT_USD,
    validate: moneyRange(PC_DEPOSIT_MIN_USD, PC_DEPOSIT_MAX_USD),
    audit: true,
    sensitive: true,
  }),
  // Public quote page (/quote): page copy plus which of the ten QuoteRequest
  // fields show, in what order, with what labels — per service type (item 18).
  // Edited from the Form tab on /admin/quotes rather than Settings, because
  // that is where the client went looking for it (Q6). Defaults live in
  // @/lib/quote-page-config and match what /quote renders.
  [QUOTE_PAGE_CONFIG_KEY]: def({
    key: QUOTE_PAGE_CONFIG_KEY,
    category: "website",
    label: "Quote page form",
    default: QUOTE_PAGE_DEFAULTS,
    validate: quotePageConfig(),
    audit: true,
  }),
  // Customer-facing website domain (display/links only until DNS is connected).
  "website.customDomain": def({
    key: "website.customDomain",
    category: "website",
    label: "Custom domain",
    default: "",
    validate: (v) => {
      if (typeof v !== "string") return { ok: false, error: "Must be text" };
      const s = v.trim().toLowerCase();
      if (s === "") return { ok: true, value: "" };
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s))
        return { ok: false, error: "Enter a valid domain, e.g. teamcleano.com" };
      return { ok: true, value: s };
    },
    audit: true,
  }),
};

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = (typeof SETTINGS)[K]["default"];

/** Typed accessor for a registry entry. */
export function getSettingDef<K extends SettingKey>(
  key: K
): SettingDef<SettingValue<K>> {
  return SETTINGS[key] as unknown as SettingDef<SettingValue<K>>;
}

/** Loose lookup by string key (for the write path, which receives raw keys). */
export function findSettingDef(key: string): SettingDef<unknown> | undefined {
  return (SETTINGS as Record<string, SettingDef<unknown>>)[key];
}
