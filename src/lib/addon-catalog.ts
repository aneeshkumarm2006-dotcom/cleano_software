import { addOnKey } from "./checklist-triggers";
import type { BkAddOn } from "./bookingkoala/core";

/**
 * THE add-on catalog: shape, validation, and resolution.
 *
 * The catalog lives as JSON in the `pricing.addOns` AppSetting. It is NOT in
 * src/lib/settings/registry.ts, so `updateAppSetting` writes it through the
 * legacy raw-upsert path with **no validation of any kind**. `normalizeAddOn`
 * below is therefore the only gate between whatever an admin's browser posted
 * and what every /book visitor is served — which is why it whitelists and
 * bounds each field rather than spreading the stored object.
 *
 * This module exists because `getBookingConfig.ts` is `"use server"` and may
 * only export async functions, so the normalizer physically cannot be shared
 * from there. Before this, the shape was declared three times (getBookingConfig,
 * PricingRulesTab, book/types) and they had already drifted on which fields
 * were optional.
 */

export type RoomType =
  | "KITCHEN"
  | "BATHROOM"
  | "BEDROOM"
  | "LIVING_ROOM"
  | "LAUNDRY"
  | "OUTDOOR"
  | "WHOLE_HOME";

export const ROOM_TYPES: readonly RoomType[] = [
  "KITCHEN",
  "BATHROOM",
  "BEDROOM",
  "LIVING_ROOM",
  "LAUNDRY",
  "OUTDOOR",
  "WHOLE_HOME",
];

const VALID_ROOMS: ReadonlySet<string> = new Set(ROOM_TYPES);

/** Bounds on admin-authored customer-facing copy (item 17). */
export const ADDON_POPUP_TITLE_MAX = 120;
export const ADDON_POPUP_MESSAGE_MAX = 1000;

export interface AddOnCatalogEntry {
  id: string;
  name: string;
  price: number;
  roomType: RoomType;
  /** Service types this add-on is offered for. Empty = all services. */
  services: string[];
  /**
   * Explicit icon key into ADDON_ICONS (item 17). Absent = fall back to the
   * keyword guess in addon-icons.ts.
   */
  icon?: string;
  /** Show a message to the customer when they select this add-on (item 17). */
  popupEnabled?: boolean;
  popupTitle?: string;
  popupMessage?: string;
  /** Tell the customer a photo will be requested for an accurate quote. */
  popupRequestPhoto?: boolean;
}

function boundedString(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Validate one raw catalog entry.
 *
 * Every optional field is checked and copied INDIVIDUALLY — never spread from
 * the stored object. A spread would forward arbitrary admin-supplied JSON to
 * every public /book visitor, and this setting has no write-side validation to
 * fall back on.
 *
 * `validIconKeys` is injected rather than imported so this module stays free of
 * the lucide dependency (it is imported by the BookingKoala import path, which
 * has no business pulling in an icon library).
 */
export function normalizeAddOn(
  raw: unknown,
  validIconKeys?: ReadonlySet<string>
): AddOnCatalogEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : null;
  const name = typeof r.name === "string" ? r.name : null;
  const price = typeof r.price === "number" ? r.price : null;
  if (!id || !name || price === null || price < 0) return null;
  const roomCandidate =
    typeof r.roomType === "string" ? (r.roomType as RoomType) : "WHOLE_HOME";
  const roomType = VALID_ROOMS.has(roomCandidate) ? roomCandidate : "WHOLE_HOME";
  const services = Array.isArray(r.services)
    ? r.services.filter((s): s is string => typeof s === "string")
    : [];

  const entry: AddOnCatalogEntry = { id, name, price, roomType, services };

  // An unknown icon key falls back to the keyword guess rather than reaching
  // the renderer, where `undefined` as a component would crash the page.
  if (typeof r.icon === "string") {
    const icon = r.icon.trim();
    if (icon && (!validIconKeys || validIconKeys.has(icon))) entry.icon = icon;
  }
  // Strict === true: a stored "yes" or 1 must not read as enabled.
  if (r.popupEnabled === true) entry.popupEnabled = true;
  if (r.popupRequestPhoto === true) entry.popupRequestPhoto = true;
  const popupTitle = boundedString(r.popupTitle, ADDON_POPUP_TITLE_MAX);
  if (popupTitle) entry.popupTitle = popupTitle;
  const popupMessage = boundedString(r.popupMessage, ADDON_POPUP_MESSAGE_MAX);
  if (popupMessage) entry.popupMessage = popupMessage;

  return entry;
}

/** Normalise a whole stored catalog value, dropping anything invalid. */
export function normalizeAddOnCatalog(
  value: unknown,
  validIconKeys?: ReadonlySet<string>
): AddOnCatalogEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => normalizeAddOn(v, validIconKeys))
    .filter((a): a is AddOnCatalogEntry => a !== null);
}

export interface ResolvedBkAddOn {
  name: string;
  price: number;
  quantity: number;
}

/**
 * Match BookingKoala add-on names against the Cleano catalog.
 *
 * ## Why every row is priced at $0
 *
 * An imported job's `subtotalAmount` is the CSV's "Service total", which is
 * what BookingKoala actually billed the customer — extras INCLUDED. Attaching
 * the catalog price to these rows would make every downstream consumer add the
 * extras a second time: `generateInvoiceFromJob` sums its line items, so a $210
 * job with a $25 fridge would invoice $235 for work already paid in full.
 *
 * So these rows are DESCRIPTIVE: what was booked and how many, never what it
 * costs. The CSV total stays the single source of truth. The catalog price is
 * recorded in the admin job log instead, so an admin who wants to re-price one
 * has the number to hand.
 *
 * `computeJobMoney` independently classifies `bookingkoala_import` as a source
 * whose add-ons are already inside its subtotal, so this is belt and braces:
 * either alone prevents the double-count.
 *
 * Matching is by `addOnKey` — the canonical normaliser (trim, lowercase,
 * collapse whitespace) — never by id, since BookingKoala has no Cleano ids.
 */
export function resolveBkAddOns(
  parsed: readonly BkAddOn[],
  catalog: readonly { name: string }[]
): { rows: ResolvedBkAddOn[]; review: BkAddOn[] } {
  const byKey = new Map(catalog.map((c) => [addOnKey(c.name), c]));
  const rows: ResolvedBkAddOn[] = [];
  const review: BkAddOn[] = [];
  for (const a of parsed) {
    const hit = byKey.get(addOnKey(a.name));
    rows.push({
      // Matched rows take the CANONICAL catalog name so checklist triggers,
      // equipment kits and the admin picker all recognise them.
      name: hit ? hit.name : a.name,
      price: 0,
      quantity: a.quantity,
    });
    if (!hit) review.push(a);
  }
  return { rows, review };
}
