// The URL contract for /admin/availability — the all-cleaner availability view
// (cleano_inventory_operations_fixes PDF #12, p.8 / Stage 12).
//
// PURE module — no Prisma, no `db`, no `next/headers`. Same constraint (and same
// reason) as `src/lib/availability.ts`: BOTH ends of the deep link import it.
// The page parses its search params through `parseAvailabilityViewQuery`, and
// the job form's assignment advisory builds its "See all availability →" href
// through `availabilityViewHref` from a client component. One module means the
// link the New Job form emits and the filter the page reads cannot drift apart —
// a broken deep link here is silent, because a page with an unparsed filter still
// renders perfectly, just showing the wrong roster.
//
// EVERY value is validated on parse. A date that isn't a date, a status that
// isn't a status and a category that isn't in the catalog all fall back to the
// default rather than reaching a query.

import {
  DATE_KEY_RE,
  TIME_RE,
  type AvailabilityResult,
} from "./availability";
import {
  PERMISSION_CATEGORIES,
  canonicalPermissionCategory,
} from "./service-permissions";

export const AVAILABILITY_VIEW_PATH = "/admin/availability";

/** Week grid (cleaners × Mon–Sun) or the date-specific day list. */
export type AvailabilityViewMode = "week" | "day";
export const AVAILABILITY_VIEW_MODES: AvailabilityViewMode[] = ["week", "day"];

/**
 * The availability-status filter positions (PDF #12's "availability status").
 *
 * TWO positions, not four, and NO_DATA is in NEITHER of them. A cleaner who has
 * never entered availability is not "unavailable" — they are unknown, and
 * sweeping them into the unavailable bucket would send an admin chasing people
 * who simply haven't filled the form in. It is the same stance
 * `availabilityWarning` takes when it declines to warn about NO_DATA. The board
 * reports the unknown count separately instead, so the roster still adds up.
 */
export type AvailabilityStatusFilter = "all" | "available" | "unavailable";
export const AVAILABILITY_STATUS_FILTERS: AvailabilityStatusFilter[] = [
  "all",
  "available",
  "unavailable",
];
export const AVAILABILITY_STATUS_FILTER_LABEL: Record<
  AvailabilityStatusFilter,
  string
> = {
  all: "Everyone",
  available: "Available",
  unavailable: "Not available",
};

/** The `lead` value meaning "cleaners who report to no Field Lead". */
export const NO_FIELD_LEAD = "none";

/** Human label per evaluation result, shared by the day list and its legend. */
export const AVAILABILITY_RESULT_LABEL: Record<AvailabilityResult, string> = {
  AVAILABLE: "Available",
  UNAVAILABLE: "Unavailable",
  OUTSIDE_HOURS: "Not working",
  NO_DATA: "No availability set",
};

/** Badge tone per result. Maps onto the `Badge` variants the admin app uses. */
export const AVAILABILITY_RESULT_TONE: Record<
  AvailabilityResult,
  "success" | "error" | "warning" | "default"
> = {
  AVAILABLE: "success",
  UNAVAILABLE: "error",
  OUTSIDE_HOURS: "warning",
  NO_DATA: "default",
};

/** Does this result count as "available" for the status filter? */
export function matchesStatusFilter(
  result: AvailabilityResult,
  filter: AvailabilityStatusFilter
): boolean {
  if (filter === "all") return true;
  if (filter === "available") return result === "AVAILABLE";
  // "unavailable" — everything genuinely negative, but never the unknown case.
  return result === "UNAVAILABLE" || result === "OUTSIDE_HOURS";
}

export interface AvailabilityViewQuery {
  view: AvailabilityViewMode;
  /** Selected civil date, "YYYY-MM-DD". Null = the page falls back to today. */
  date: string | null;
  /** Optional wall-clock window for the day view ("who can work 9–12?"). */
  from: string | null;
  to: string | null;
  /** Free-text cleaner search (name or email). */
  q: string;
  /** Canonical service-category key, or null for every category. */
  category: string | null;
  /** Field Lead id, `NO_FIELD_LEAD`, or null for every group. */
  lead: string | null;
  status: AvailabilityStatusFilter;
  /** Include deactivated cleaners. Off by default — see the board's comment. */
  includeInactive: boolean;
}

export const AVAILABILITY_VIEW_DEFAULTS: AvailabilityViewQuery = {
  view: "week",
  date: null,
  from: null,
  to: null,
  q: "",
  category: null,
  lead: null,
  status: "all",
  includeInactive: false,
};

/** Longest search string we will carry into a `contains` query. */
const MAX_SEARCH = 80;

type RawParams = Record<string, string | string[] | undefined>;

function one(raw: RawParams, key: string): string | null {
  const v = raw[key];
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== "string") return null;
  const trimmed = s.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Search params → a validated query. Anything unrecognised falls back to the
 * default, so a hand-edited URL can widen nothing and break nothing.
 */
export function parseAvailabilityViewQuery(raw: RawParams): AvailabilityViewQuery {
  const view = one(raw, "view");
  const date = one(raw, "date");
  const from = one(raw, "from");
  const to = one(raw, "to");
  const q = one(raw, "q");
  const category = one(raw, "category");
  const lead = one(raw, "lead");
  const status = one(raw, "status");
  const inactive = one(raw, "inactive");

  const categoryKey = category
    ? canonicalPermissionCategory(category.toUpperCase())
    : null;

  const validFrom = from && TIME_RE.test(from) ? from : null;
  // An end without a start is not a window — the day view would silently
  // evaluate "00:00 to 12:00" and call the morning crew unavailable. An end
  // BEFORE its start is not one either: `evaluateAvailability` would clamp it to
  // a zero-length probe at the start time, answering a question nobody asked.
  const validTo =
    validFrom && to && TIME_RE.test(to) && to > validFrom ? to : null;

  return {
    view:
      view && (AVAILABILITY_VIEW_MODES as string[]).includes(view)
        ? (view as AvailabilityViewMode)
        : AVAILABILITY_VIEW_DEFAULTS.view,
    date: date && DATE_KEY_RE.test(date) ? date : null,
    from: validFrom,
    to: validTo,
    q: q ? q.slice(0, MAX_SEARCH) : "",
    category:
      categoryKey && PERMISSION_CATEGORIES.some((c) => c.key === categoryKey)
        ? categoryKey
        : null,
    lead: lead ?? null,
    status:
      status && (AVAILABILITY_STATUS_FILTERS as string[]).includes(status)
        ? (status as AvailabilityStatusFilter)
        : AVAILABILITY_VIEW_DEFAULTS.status,
    includeInactive: inactive === "1" || inactive === "true",
  };
}

/**
 * Build a link into the view. Only non-default values are emitted, so the plain
 * page is `/admin/availability` and a shared URL carries exactly the filters
 * that are switched on.
 */
export function availabilityViewHref(
  query: Partial<AvailabilityViewQuery> = {}
): string {
  const params = new URLSearchParams();
  const set = (key: string, value: string | null | undefined) => {
    if (value) params.set(key, value);
  };

  if (query.view && query.view !== AVAILABILITY_VIEW_DEFAULTS.view) {
    params.set("view", query.view);
  }
  if (query.date && DATE_KEY_RE.test(query.date)) params.set("date", query.date);
  // Same rules as the parser, so `parse ∘ build` is the identity: an end time
  // is only carried when it has a start, and only when it comes after it.
  if (query.from && TIME_RE.test(query.from)) {
    params.set("from", query.from);
    if (query.to && TIME_RE.test(query.to) && query.to > query.from) {
      params.set("to", query.to);
    }
  }
  set("q", query.q?.trim() ? query.q.trim().slice(0, MAX_SEARCH) : null);
  set("category", query.category ?? null);
  set("lead", query.lead ?? null);
  if (query.status && query.status !== AVAILABILITY_VIEW_DEFAULTS.status) {
    params.set("status", query.status);
  }
  if (query.includeInactive) params.set("inactive", "1");

  const qs = params.toString();
  return qs ? `${AVAILABILITY_VIEW_PATH}?${qs}` : AVAILABILITY_VIEW_PATH;
}

/**
 * The link the job form's assignment advisory points at: the DAY view, on the
 * job's own date, pre-filled with the job's window. `date` is what makes the
 * link worth showing at all — without one there is nothing to pre-filter, so
 * the caller renders nothing.
 */
export function assignmentAvailabilityHref(
  date: string | null | undefined,
  startTime?: string | null,
  endTime?: string | null
): string | null {
  if (!date || !DATE_KEY_RE.test(date)) return null;
  return availabilityViewHref({
    view: "day",
    date,
    from: startTime ?? null,
    to: endTime ?? null,
  });
}

/** True when any filter is narrowing the roster (drives "Clear filters"). */
export function isAvailabilityFiltered(query: AvailabilityViewQuery): boolean {
  return (
    query.q !== "" ||
    query.category !== null ||
    query.lead !== null ||
    query.status !== "all" ||
    query.from !== null ||
    query.includeInactive
  );
}
