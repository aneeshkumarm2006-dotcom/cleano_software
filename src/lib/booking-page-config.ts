/**
 * Admin-editable configuration for the public booking flow (`/book`).
 *
 * Item 17, the client's strongest ask: *"this should all be editable from the
 * admin end. There's no reason why this should be something that's coded on
 * your end."* Items 13 (no square footage for Standard/Airbnb), 14 (Airbnb
 * frequency labels), 15 (no frequency for Move-in/out and Deep) and 16
 * (email + phone leading the contact step) are delivered as **defaults in this
 * file**, not as `if` statements in the step components — so the next change of
 * that class is a settings edit rather than a code request.
 *
 * Scope is bounded (decision D7): show/hide, reorder, and edit labels + help
 * text, per service type. There are no admin-defined custom field *types* and
 * no drag-and-drop form builder — the field catalog below is fixed, because
 * every key in it is wired to a real column the booking engine reads.
 *
 * Pure module: no DB, no server-only imports, so the admin editor and the
 * public booking client can both import it.
 */

/* ------------------------------- vocabulary ------------------------------- */

export const BOOKING_PAGE_CONFIG_KEY = "bookingPage.config";

export const BOOKING_STEP_IDS = [
  "postal",
  "property",
  "schedule",
  "contact",
] as const;
export type BookingStepId = (typeof BOOKING_STEP_IDS)[number];

export const BOOKING_STEP_LABELS: Record<BookingStepId, string> = {
  postal: "Step 1 — Postal code",
  property: "Step 2 — Property & service",
  schedule: "Step 3 — Schedule",
  contact: "Step 4 — Contact",
};

// Mirrors SERVICE_TYPES in app/(book)/book/types.ts. Duplicated rather than
// imported so this lib module stays free of app-router imports — the same
// arrangement service-content.ts uses.
export const BOOKING_SERVICE_TYPES: { value: string; label: string }[] = [
  { value: "STANDARD", label: "Standard cleaning" },
  { value: "DEEP", label: "Deep cleaning" },
  { value: "MOVE_IN_OUT", label: "Move-in / move-out" },
  { value: "POST_CONSTRUCTION", label: "Post-construction" },
  { value: "AIRBNB", label: "Airbnb turnover" },
];

const SERVICE_VALUES = BOOKING_SERVICE_TYPES.map((s) => s.value);

/** Frequency values the booking engine understands. Not admin-extensible. */
export const BOOKING_FREQUENCY_VALUES = [
  "ONE_TIME",
  "WEEKLY",
  "BIWEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "TWICE_WEEKLY",
  "HIGH_FREQUENCY",
] as const;

/* --------------------------------- shapes --------------------------------- */

export interface BookingFieldConfig {
  /** Stable key the step component renders against. Never admin-editable. */
  key: string;
  label: string;
  helpText: string;
  visible: boolean;
  required: boolean;
  order: number;
}

export type BookingFieldOverride = Partial<Omit<BookingFieldConfig, "key">>;

export interface BookingFrequencyOption {
  value: string;
  label: string;
  hint: string;
  visible: boolean;
  order: number;
}

export interface BookingPageConfig {
  /** Base config for every service, per step. */
  fields: Record<BookingStepId, BookingFieldConfig[]>;
  /** serviceType -> "<stepId>.<fieldKey>" -> partial override of the base. */
  overrides: Record<string, Record<string, BookingFieldOverride>>;
  /** serviceType -> the frequency choices offered for it. */
  frequencyOptions: Record<string, BookingFrequencyOption[]>;
}

/** Flat override key, so one map covers every step without nesting. */
export function overrideKey(stepId: BookingStepId, fieldKey: string): string {
  return `${stepId}.${fieldKey}`;
}

/* -------------------------------- defaults -------------------------------- */
//
// RULE (same as the settings registry): every default must equal what the
// booking page renders today, EXCEPT the four changes the client asked for:
//   13 — squareFootage hidden for STANDARD and AIRBNB
//   14 — Airbnb frequency labels read "Minimum N times per month"
//   15 — frequency hidden for MOVE_IN_OUT and DEEP
//   16 — email and phone are the first two fields of the contact step
// Each is a default in this file, so an admin can put it back without code.

const DEFAULT_FIELDS: Record<BookingStepId, BookingFieldConfig[]> = {
  postal: [
    f("postalCode", "Postal code", "", { order: 0, required: true }),
  ],
  property: [
    f("savedAddress", "Address on file", "", { order: 0 }),
    f("address", "Address", "", { order: 1, required: true }),
    f(
      "aptNumber",
      "Apartment / unit",
      "Optional — buzzer or unit number, so your cleaner can get in.",
      { order: 2 }
    ),
    f("serviceType", "Service type", "", { order: 3, required: true }),
    f("bedCount", "Bedrooms", "", { order: 4 }),
    f("bathCount", "Full bathrooms", "", { order: 5 }),
    f("halfBathCount", "Half bathrooms", "", { order: 6 }),
    f("squareFootage", "Square footage", "", { order: 7 }),
    // Post-construction only — switched on by the override below rather than
    // by an `isPC` branch in the component.
    f("pcHours", "Estimated hours (4 hr min)", "", { order: 8, visible: false }),
    f("pcCleaners", "Number of cleaners", "", { order: 9, visible: false }),
    f(
      "frequency",
      "Frequency",
      "Recurring options auto-book future visits so you don't have to. You can change or cancel any visit before it happens.",
      { order: 10 }
    ),
    f("addOns", "Add-ons", "", { order: 11 }),
  ],
  schedule: [
    f("date", "Preferred date", "", { order: 0, required: true }),
    f("timeSlot", "Choose a time", "", { order: 1 }),
  ],
  contact: [
    // Item 16 / decision D8: email and phone lead the step.
    f("email", "Email", "", { order: 0, required: true }),
    f("phone", "Phone", "", { order: 1, required: true }),
    f("name", "Full name", "", { order: 2, required: true }),
    f("notes", "Notes", "", { order: 3 }),
    f("referralCode", "Referral code (optional)", "", { order: 4 }),
    f("promoCode", "Promo code (optional)", "", { order: 5 }),
    f(
      "smsConsent",
      "Send me booking updates and reminders by SMS. Message and data rates may apply; you can opt out anytime.",
      "",
      { order: 6 }
    ),
  ],
};

const DEFAULT_OVERRIDES: Record<string, Record<string, BookingFieldOverride>> = {
  // Item 13 — "a lot of people don't know their square footage".
  STANDARD: {
    "property.squareFootage": { visible: false },
  },
  AIRBNB: {
    "property.squareFootage": { visible: false },
    "property.frequency": {
      helpText:
        "Airbnb turnover discounts apply automatically when you book recurring cleans.",
    },
  },
  // Item 15 — one-off price only, no recurring discount.
  DEEP: {
    "property.frequency": { visible: false },
  },
  MOVE_IN_OUT: {
    // Priced per square foot, so it stays visible AND required (locked below).
    "property.squareFootage": { label: "Square footage (required)", required: true },
    "property.frequency": { visible: false },
  },
  // Post-construction is quoted on hours × crew, so the room counts and the
  // square footage give way to the two estimate steppers.
  POST_CONSTRUCTION: {
    "property.bedCount": { visible: false },
    "property.bathCount": { visible: false },
    "property.halfBathCount": { visible: false },
    "property.squareFootage": { visible: false },
    "property.pcHours": { visible: true },
    "property.pcCleaners": { visible: true },
    "property.frequency": { visible: false },
  },
};

const STANDARD_FREQUENCIES: BookingFrequencyOption[] = [
  o("ONE_TIME", "One-time", "Just this cleaning", 0),
  o("WEEKLY", "Weekly", "Auto-books the next 4 weekly visits", 1),
  o("BIWEEKLY", "Every 2 weeks", "Auto-books the next 4 visits", 2),
  o("MONTHLY", "Monthly", "Auto-books the next 3 monthly visits", 3),
  o("QUARTERLY", "Quarterly", "Auto-books the next 2 quarterly visits", 4),
];

// Item 14 — the client self-corrected from "roughly" to "minimum": the labels
// state a monthly visit count instead of a cadence.
const AIRBNB_FREQUENCY_OPTIONS: BookingFrequencyOption[] = [
  o("ONE_TIME", "One-time", "Full price", 0),
  o("BIWEEKLY", "Minimum 2 times per month", "", 1),
  o("WEEKLY", "Minimum 4 times per month", "", 2),
  o("TWICE_WEEKLY", "Minimum 8 times per month", "", 3),
  o("HIGH_FREQUENCY", "Minimum 20 times per month", "", 4),
];

const DEFAULT_FREQUENCY_OPTIONS: Record<string, BookingFrequencyOption[]> = {
  STANDARD: STANDARD_FREQUENCIES,
  DEEP: STANDARD_FREQUENCIES,
  MOVE_IN_OUT: STANDARD_FREQUENCIES,
  POST_CONSTRUCTION: STANDARD_FREQUENCIES,
  AIRBNB: AIRBNB_FREQUENCY_OPTIONS,
};

export const BOOKING_PAGE_DEFAULTS: BookingPageConfig = {
  fields: DEFAULT_FIELDS,
  overrides: DEFAULT_OVERRIDES,
  frequencyOptions: DEFAULT_FREQUENCY_OPTIONS,
};

function f(
  key: string,
  label: string,
  helpText: string,
  opts: { order: number; visible?: boolean; required?: boolean }
): BookingFieldConfig {
  return {
    key,
    label,
    helpText,
    visible: opts.visible ?? true,
    required: opts.required ?? false,
    order: opts.order,
  };
}

function o(
  value: string,
  label: string,
  hint: string,
  order: number
): BookingFrequencyOption {
  return { value, label, hint, visible: true, order };
}

/* --------------------------------- locks ---------------------------------- */
//
// Fields the booking ENGINE requires. `submitBooking` rejects a booking without
// them, and move-in/out cannot be priced without square footage — so hiding or
// un-requiring one from Settings would produce a form whose submissions always
// fail. They stay relabellable and reorderable; only visible/required are
// pinned. The admin editor renders these toggles disabled with a reason.

const LOCKED_FIELDS = new Set<string>([
  "postal.postalCode",
  "property.address",
  "property.serviceType",
  "schedule.date",
  "contact.name",
  "contact.email",
  "contact.phone",
]);

/** True when visible/required for this field are pinned on and not editable. */
export function isLockedField(
  stepId: BookingStepId,
  fieldKey: string,
  serviceType?: string
): boolean {
  if (LOCKED_FIELDS.has(overrideKey(stepId, fieldKey))) return true;
  // Move-in/out is priced per square foot — see moveInOutBasePrice().
  return (
    serviceType === "MOVE_IN_OUT" &&
    stepId === "property" &&
    fieldKey === "squareFootage"
  );
}

export const LOCKED_FIELD_REASON =
  "Required by the booking engine — a booking cannot be submitted without it.";

/* ------------------------------ normalization ----------------------------- */

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function boolOr(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function orderOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Coerce a stored (possibly partial, legacy, or hand-edited) value into a full,
 * safe config.
 *
 * The field catalog is authoritative: unknown keys in storage are dropped and
 * missing keys fall back to their default, so a stored config can never delete
 * a field the components render or invent one they don't.
 */
export function normalizeBookingPageConfig(raw: unknown): BookingPageConfig {
  const stored = (raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw
    : {}) as Partial<Record<keyof BookingPageConfig, unknown>>;

  return {
    fields: normalizeFields(stored.fields),
    overrides: normalizeOverrides(stored.overrides),
    frequencyOptions: normalizeFrequencyOptions(stored.frequencyOptions),
  };
}

function normalizeFields(raw: unknown): BookingPageConfig["fields"] {
  const stored = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const out = {} as BookingPageConfig["fields"];
  for (const stepId of BOOKING_STEP_IDS) {
    const rows = Array.isArray(stored[stepId])
      ? (stored[stepId] as unknown[])
      : [];
    const byKey = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      if (r && typeof r === "object" && typeof (r as { key?: unknown }).key === "string") {
        byKey.set((r as { key: string }).key, r as Record<string, unknown>);
      }
    }
    out[stepId] = DEFAULT_FIELDS[stepId].map((d) => {
      const s = byKey.get(d.key);
      if (!s) return { ...d };
      return {
        key: d.key,
        label: str(s.label, d.label).slice(0, 160),
        helpText: str(s.helpText, d.helpText).slice(0, 400),
        visible: boolOr(s.visible, d.visible),
        required: boolOr(s.required, d.required),
        order: orderOr(s.order, d.order),
      };
    });
  }
  return out;
}

function normalizeOverrides(raw: unknown): BookingPageConfig["overrides"] {
  const stored = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const validKeys = new Set<string>();
  for (const stepId of BOOKING_STEP_IDS) {
    for (const d of DEFAULT_FIELDS[stepId]) validKeys.add(overrideKey(stepId, d.key));
  }

  const out: BookingPageConfig["overrides"] = {};
  for (const service of SERVICE_VALUES) {
    const rowRaw = stored[service];
    // A service PRESENT in storage replaces its default override map wholesale,
    // empty map included — that is how an admin un-does a shipped default (e.g.
    // showing square footage for Standard again). Falling back to the defaults
    // for an empty-but-present map would silently undo that edit on the next
    // read. Absent = never edited, so the shipped defaults still apply.
    const present =
      !!rowRaw && typeof rowRaw === "object" && !Array.isArray(rowRaw);
    const source = (present
      ? rowRaw
      : DEFAULT_OVERRIDES[service]) as Record<string, unknown> | undefined;
    if (!source) continue;

    const clean: Record<string, BookingFieldOverride> = {};
    for (const [k, v] of Object.entries(source)) {
      if (!validKeys.has(k) || !v || typeof v !== "object") continue;
      const o = v as Record<string, unknown>;
      const patch: BookingFieldOverride = {};
      if (typeof o.label === "string") patch.label = o.label.slice(0, 160);
      if (typeof o.helpText === "string") patch.helpText = o.helpText.slice(0, 400);
      if (typeof o.visible === "boolean") patch.visible = o.visible;
      if (typeof o.required === "boolean") patch.required = o.required;
      if (typeof o.order === "number" && Number.isFinite(o.order)) patch.order = o.order;
      if (Object.keys(patch).length > 0) clean[k] = patch;
    }
    if (present || Object.keys(clean).length > 0) out[service] = clean;
  }
  return out;
}

function normalizeFrequencyOptions(
  raw: unknown
): BookingPageConfig["frequencyOptions"] {
  const stored = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const allowed = new Set<string>(BOOKING_FREQUENCY_VALUES);
  const out: BookingPageConfig["frequencyOptions"] = {};

  for (const service of SERVICE_VALUES) {
    const defaults = DEFAULT_FREQUENCY_OPTIONS[service] ?? STANDARD_FREQUENCIES;
    const rows = Array.isArray(stored[service]) ? (stored[service] as unknown[]) : [];
    const byValue = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      if (r && typeof r === "object") {
        const v = (r as { value?: unknown }).value;
        if (typeof v === "string" && allowed.has(v)) {
          byValue.set(v, r as Record<string, unknown>);
        }
      }
    }
    out[service] = defaults.map((d) => {
      const s = byValue.get(d.value);
      if (!s) return { ...d };
      return {
        value: d.value,
        label: str(s.label, d.label).slice(0, 120),
        hint: str(s.hint, d.hint).slice(0, 200),
        // ONE_TIME can never be hidden: a customer must always be able to book
        // a single cleaning, and hiding it would strand every non-recurring
        // booking on a form with no valid choice.
        visible: d.value === "ONE_TIME" ? true : boolOr(s.visible, d.visible),
        order: orderOr(s.order, d.order),
      };
    });
  }
  return out;
}

/* -------------------------------- resolvers ------------------------------- */

/** The effective config for one field: base, then this service's override. */
export function resolveField(
  cfg: BookingPageConfig,
  stepId: BookingStepId,
  fieldKey: string,
  serviceType?: string
): BookingFieldConfig | null {
  const base = cfg.fields[stepId]?.find((x) => x.key === fieldKey);
  if (!base) return null;
  const patch = serviceType
    ? cfg.overrides[serviceType]?.[overrideKey(stepId, fieldKey)]
    : undefined;
  const merged: BookingFieldConfig = patch ? { ...base, ...patch, key: base.key } : { ...base };
  if (isLockedField(stepId, fieldKey, serviceType)) {
    merged.visible = true;
    merged.required = true;
  }
  return merged;
}

/** Every field of a step for this service, ordered. Includes hidden ones. */
export function resolveStepFields(
  cfg: BookingPageConfig,
  stepId: BookingStepId,
  serviceType?: string
): BookingFieldConfig[] {
  return (cfg.fields[stepId] ?? [])
    .map((base) => resolveField(cfg, stepId, base.key, serviceType)!)
    .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}

/** Only the fields a customer actually sees, ordered. */
export function resolveVisibleFields(
  cfg: BookingPageConfig,
  stepId: BookingStepId,
  serviceType?: string
): BookingFieldConfig[] {
  return resolveStepFields(cfg, stepId, serviceType).filter((x) => x.visible);
}

export function isFieldVisible(
  cfg: BookingPageConfig,
  stepId: BookingStepId,
  fieldKey: string,
  serviceType?: string
): boolean {
  return resolveField(cfg, stepId, fieldKey, serviceType)?.visible ?? false;
}

export function isFieldRequired(
  cfg: BookingPageConfig,
  stepId: BookingStepId,
  fieldKey: string,
  serviceType?: string
): boolean {
  const x = resolveField(cfg, stepId, fieldKey, serviceType);
  return !!x && x.visible && x.required;
}

/** Frequency choices offered for a service, ordered. Includes hidden ones. */
export function resolveFrequencyOptions(
  cfg: BookingPageConfig,
  serviceType: string
): BookingFrequencyOption[] {
  const rows = cfg.frequencyOptions[serviceType] ?? cfg.frequencyOptions.STANDARD ?? [];
  return [...rows].sort((a, b) => a.order - b.order);
}

export function resolveVisibleFrequencyOptions(
  cfg: BookingPageConfig,
  serviceType: string
): BookingFrequencyOption[] {
  return resolveFrequencyOptions(cfg, serviceType).filter((x) => x.visible);
}

/**
 * The customer-facing label for a chosen frequency (review screen, emails).
 * Falls back to the raw value so an unknown code still renders something.
 */
export function frequencyLabel(
  cfg: BookingPageConfig,
  serviceType: string,
  frequency: string
): string {
  return (
    resolveFrequencyOptions(cfg, serviceType).find((x) => x.value === frequency)
      ?.label ?? frequency
  );
}

/**
 * Does this service offer a frequency choice at all?
 *
 * When it doesn't (Move-in/out and Deep by default — item 15), the booking must
 * be one-off: no recurring series, no recurring discount. Both the client and
 * `submitBooking` consult this so a crafted request can't create a series the
 * form never offered.
 */
export function frequencyEnabled(
  cfg: BookingPageConfig,
  serviceType: string
): boolean {
  return (
    isFieldVisible(cfg, "property", "frequency", serviceType) &&
    resolveVisibleFrequencyOptions(cfg, serviceType).some(
      (x) => x.value !== "ONE_TIME"
    )
  );
}
