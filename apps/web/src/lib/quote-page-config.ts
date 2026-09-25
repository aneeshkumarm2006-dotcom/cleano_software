/**
 * Admin-editable configuration for the public quote-request page (`/quote`).
 *
 * Item 18 (Q6): *"whatever quote request page you're going to embed, you should
 * be able to edit the UI and the fields inside of the quote page directly from
 * over here. If ever you want to stop offering a service, you could just edit
 * the quote form right from here."*
 *
 * `/quote` was 328 lines of literals: ten fields written as static JSX, page
 * copy inline, and a `SERVICE_OPTIONS` array that contradicted the
 * admin-editable service catalog fourteen other files already consume. This
 * module is the settings layer that makes copy, field list, ordering, labels,
 * help text and per-service visibility editable with no code — the same shape
 * as `booking-page-config.ts` does for `/book`, deliberately, so there is one
 * pattern for "a public form the admin controls" rather than two.
 *
 * Scope is bounded (decision D7 / Q6 §C): show/hide, reorder, relabel, require,
 * per service. There are no admin-defined custom field *types* and no form
 * builder — the catalog below is fixed because every key in it is a real
 * `QuoteRequest` column. Adding a question means a column (or the phase-2
 * `customFields Json?`), not a settings edit.
 *
 * The service list itself is NOT here: it comes from `service-catalog.ts`
 * (Settings → Job Types), which is the whole point of 10.1.
 *
 * TODO(client): phase 2 (10.5) — admin-defined CUSTOM QUESTIONS. Deliberately
 * not built. They need somewhere to put the answers, and the right shape is one
 * `QuoteRequest.customFields Json?` column (the only migration in this area)
 * rendered in the inbox drawer, NOT a column per question. When it lands, the
 * catalog above stops being the whole field list: `QUOTE_FIELD_KEYS` becomes
 * the fixed core and custom entries are appended, so `resolveQuoteFields` and
 * the renderer's `switch` are the two places that change.
 *
 * Pure module — no DB, no server-only imports — so the admin editor and the
 * public form can both import it.
 */

import { SERVICE_CATEGORY_KEYS } from "./calendar-labels";

/* ------------------------------- vocabulary ------------------------------- */

export const QUOTE_PAGE_CONFIG_KEY = "quotePage.config";

/**
 * The ten `QuoteRequest` columns, in the order the page renders them today.
 * This list is authoritative: a stored config can neither delete a field the
 * renderer knows about nor invent one it doesn't.
 */
export const QUOTE_FIELD_KEYS = [
  "name",
  "email",
  "phone",
  "serviceType",
  "address",
  "bedCount",
  "bathCount",
  "squareFootage",
  "preferredDate",
  "message",
] as const;

export type QuoteFieldKey = (typeof QUOTE_FIELD_KEYS)[number];

const FIELD_KEY_SET = new Set<string>(QUOTE_FIELD_KEYS);

export function isQuoteFieldKey(v: unknown): v is QuoteFieldKey {
  return typeof v === "string" && FIELD_KEY_SET.has(v);
}

/* --------------------------------- shapes --------------------------------- */

export interface QuoteFieldConfig {
  /** Stable key = the QuoteRequest column. Never admin-editable. */
  key: QuoteFieldKey;
  label: string;
  helpText: string;
  visible: boolean;
  required: boolean;
  order: number;
}

export type QuoteFieldOverride = Partial<Omit<QuoteFieldConfig, "key">>;

export interface QuotePageCopy {
  /** Blank falls back to the business name, so a rename follows the brand. */
  eyebrow: string;
  title: string;
  subhead: string;
  submitLabel: string;
  successTitle: string;
  successBody: string;
}

export interface QuotePageConfig {
  copy: QuotePageCopy;
  /** Base config, applied to every service. */
  fields: QuoteFieldConfig[];
  /** Service category key -> field key -> partial override of the base. */
  overrides: Record<string, Record<string, QuoteFieldOverride>>;
}

/* -------------------------------- defaults -------------------------------- */
//
// RULE (same as the settings registry): every default must equal what /quote
// renders today, so until an admin edits anything the page is byte-for-byte
// unchanged. The one intentional exception is the eyebrow, which was the
// literal "Cleano" and is now the `general.businessName` setting — same string
// for this store, correct for any other.

const DEFAULT_COPY: QuotePageCopy = {
  eyebrow: "",
  title: "Request a quote",
  subhead:
    "Tell us a few details about your space and we'll get back to you within one business day with a tailored estimate.",
  submitLabel: "Request my quote",
  successTitle: "Got it — we'll be in touch",
  successBody:
    "Thanks for the details. A member of our team will follow up by email within one business day with pricing and next steps.",
};

const DEFAULT_FIELDS: QuoteFieldConfig[] = [
  f("name", "Full name", "", { order: 0, required: true }),
  f("email", "Email", "", { order: 1, required: true }),
  f("phone", "Phone", "", { order: 2 }),
  f("serviceType", "Service type", "", { order: 3 }),
  f("address", "Address", "", { order: 4 }),
  f("bedCount", "Bedrooms", "", { order: 5 }),
  f("bathCount", "Bathrooms", "", { order: 6 }),
  f("squareFootage", "Square footage", "", { order: 7 }),
  f("preferredDate", "Preferred date", "", { order: 8 }),
  f("message", "Anything else we should know?", "", { order: 9 }),
];

/**
 * No shipped per-service overrides: today every field shows for every service,
 * and the registry rule is that defaults reproduce current behaviour. Hiding
 * bedrooms for Commercial is exactly the edit the admin now makes themselves —
 * shipping it as a default would be this stage making a business decision.
 */
const DEFAULT_OVERRIDES: Record<string, Record<string, QuoteFieldOverride>> = {};

export const QUOTE_PAGE_DEFAULTS: QuotePageConfig = {
  copy: DEFAULT_COPY,
  fields: DEFAULT_FIELDS,
  overrides: DEFAULT_OVERRIDES,
};

function f(
  key: QuoteFieldKey,
  label: string,
  helpText: string,
  opts: { order: number; visible?: boolean; required?: boolean }
): QuoteFieldConfig {
  return {
    key,
    label,
    helpText,
    visible: opts.visible ?? true,
    required: opts.required ?? false,
    order: opts.order,
  };
}

/* --------------------------------- locks ---------------------------------- */
//
// `submitQuote` rejects a submission without a name and a valid email, and the
// inbox is unusable without them (there is nobody to reply to). Hiding or
// un-requiring one from Settings would produce a form whose submissions always
// fail — the same failure mode the booking page's locked fields prevent. They
// stay relabellable and reorderable; only visible/required are pinned.

const LOCKED_FIELDS = new Set<QuoteFieldKey>(["name", "email"]);

export function isLockedQuoteField(key: string): boolean {
  return LOCKED_FIELDS.has(key as QuoteFieldKey);
}

export const LOCKED_QUOTE_FIELD_REASON =
  "Required to answer the request — a quote cannot be submitted or replied to without it.";

/* -------------------------------- layout ---------------------------------- */
//
// Which fields sit two-up. Presentation, not configuration: an admin reorders
// and hides fields, they don't lay out a grid. Full-width fields span the row
// wherever they land, so any ordering still renders sensibly.

const FULL_WIDTH_FIELDS = new Set<QuoteFieldKey>(["address", "message"]);

export function isFullWidthQuoteField(key: QuoteFieldKey): boolean {
  return FULL_WIDTH_FIELDS.has(key);
}

/* ------------------------------ normalization ----------------------------- */

function str(v: unknown, fallback: string, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : fallback;
}

function boolOr(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function orderOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Coerce a stored (possibly partial, legacy, or hand-edited) value into a full,
 * safe config. Total by construction — there is no invalid input, only input
 * that falls back to a default, which is why the registry validator can't fail.
 */
export function normalizeQuotePageConfig(raw: unknown): QuotePageConfig {
  const stored = (
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}
  ) as Partial<Record<keyof QuotePageConfig, unknown>>;

  return {
    copy: normalizeCopy(stored.copy),
    fields: normalizeFields(stored.fields),
    overrides: normalizeOverrides(stored.overrides),
  };
}

function normalizeCopy(raw: unknown): QuotePageCopy {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    eyebrow: str(s.eyebrow, DEFAULT_COPY.eyebrow, 60),
    title: str(s.title, DEFAULT_COPY.title, 120),
    subhead: str(s.subhead, DEFAULT_COPY.subhead, 400),
    submitLabel: str(s.submitLabel, DEFAULT_COPY.submitLabel, 60),
    successTitle: str(s.successTitle, DEFAULT_COPY.successTitle, 120),
    successBody: str(s.successBody, DEFAULT_COPY.successBody, 400),
  };
}

function normalizeFields(raw: unknown): QuoteFieldConfig[] {
  const rows = Array.isArray(raw) ? raw : [];
  const byKey = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    if (r && typeof r === "object") {
      const k = (r as { key?: unknown }).key;
      if (isQuoteFieldKey(k)) byKey.set(k, r as Record<string, unknown>);
    }
  }
  return DEFAULT_FIELDS.map((d) => {
    const s = byKey.get(d.key);
    if (!s) return { ...d };
    return {
      key: d.key,
      label: str(s.label, d.label, 160),
      helpText: str(s.helpText, d.helpText, 400),
      visible: boolOr(s.visible, d.visible),
      required: boolOr(s.required, d.required),
      order: orderOr(s.order, d.order),
    };
  });
}

function normalizeOverrides(
  raw: unknown
): Record<string, Record<string, QuoteFieldOverride>> {
  const stored = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const out: Record<string, Record<string, QuoteFieldOverride>> = {};

  for (const service of SERVICE_CATEGORY_KEYS) {
    const rowRaw = stored[service];
    // Same rule as the booking config: a service PRESENT in storage replaces
    // its default override map wholesale, empty map included — that is how an
    // admin un-does an override. Absent = never edited.
    const present = !!rowRaw && typeof rowRaw === "object" && !Array.isArray(rowRaw);
    const source = (present ? rowRaw : DEFAULT_OVERRIDES[service]) as
      | Record<string, unknown>
      | undefined;
    if (!source) continue;

    const clean: Record<string, QuoteFieldOverride> = {};
    for (const [k, v] of Object.entries(source)) {
      if (!isQuoteFieldKey(k) || !v || typeof v !== "object") continue;
      const o = v as Record<string, unknown>;
      const patch: QuoteFieldOverride = {};
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

/* -------------------------------- resolvers ------------------------------- */

/**
 * The effective config for one field: base, then this service's override.
 *
 * `serviceType` is the CANONICAL CATEGORY KEY the visitor has picked in the
 * dropdown (RESIDENTIAL, COMMERCIAL, …), or undefined when they haven't picked
 * one yet — in which case the base config applies, so the form is never empty
 * waiting on a choice.
 */
export function resolveQuoteField(
  cfg: QuotePageConfig,
  fieldKey: QuoteFieldKey,
  serviceType?: string
): QuoteFieldConfig | null {
  const base = cfg.fields.find((x) => x.key === fieldKey);
  if (!base) return null;
  const patch = serviceType ? cfg.overrides[serviceType]?.[fieldKey] : undefined;
  const merged: QuoteFieldConfig = patch
    ? { ...base, ...patch, key: base.key }
    : { ...base };
  if (isLockedQuoteField(fieldKey)) {
    merged.visible = true;
    merged.required = true;
  }
  return merged;
}

/** Every field for this service, ordered. Includes hidden ones (for the editor). */
export function resolveQuoteFields(
  cfg: QuotePageConfig,
  serviceType?: string
): QuoteFieldConfig[] {
  return cfg.fields
    .map((base) => resolveQuoteField(cfg, base.key, serviceType)!)
    .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}

/** Only the fields a visitor actually sees, ordered. */
export function visibleQuoteFields(
  cfg: QuotePageConfig,
  serviceType?: string
): QuoteFieldConfig[] {
  return resolveQuoteFields(cfg, serviceType).filter((x) => x.visible);
}

export function isQuoteFieldVisible(
  cfg: QuotePageConfig,
  fieldKey: QuoteFieldKey,
  serviceType?: string
): boolean {
  return resolveQuoteField(cfg, fieldKey, serviceType)?.visible ?? false;
}

/** Required AND visible — a hidden field can never block a submission. */
export function isQuoteFieldRequired(
  cfg: QuotePageConfig,
  fieldKey: QuoteFieldKey,
  serviceType?: string
): boolean {
  const x = resolveQuoteField(cfg, fieldKey, serviceType);
  return !!x && x.visible && x.required;
}

/** Label for one field, for error messages and the admin preview. */
export function quoteFieldLabel(
  cfg: QuotePageConfig,
  fieldKey: QuoteFieldKey,
  serviceType?: string
): string {
  return resolveQuoteField(cfg, fieldKey, serviceType)?.label ?? fieldKey;
}
