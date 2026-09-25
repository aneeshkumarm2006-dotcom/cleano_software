// My kit: the supplies and tools a cleaner carries, and what they can say
// about them — a recount, a tool's condition, an issue (lost, broken, ran
// out), a restock request, and items they already had on hand. Plus picking
// up from a storage location.
//
// The server is the authority on every judgement here. Whether an item is
// "low" depends on the product's own restock threshold, the company default,
// and what kind of item it is (a tool never runs low), so the server computes
// `attention` with the same rule the web uses (`itemAttentionState` in
// @bookmops/core/inventory) and the app only paints it.
//
// Every route here acts on the CALLER'S OWN kit. No request carries an
// employee id: the kit row is always looked up by (session user, productId),
// so there is nothing to point at another cleaner's kit. A product that isn't
// in the caller's kit answers 404.
import { z } from "zod";

import { Instant, openEnum } from "./common";

/** What kind of thing an item is; decides how it is reported. */
export const KIT_ITEM_TYPES = ["LIQUID", "COUNTABLE_CONSUMABLE", "REUSABLE_EQUIPMENT"] as const;
/** How loudly an item's state should read. */
export const KIT_TONES = ["ok", "warn", "critical"] as const;
/** Which vocabulary `attention.label` came from. */
export const KIT_ATTENTION_KINDS = ["OK", "LOW", "EMPTY", "LEVEL", "CONDITION"] as const;
/** A liquid's reported level, fullest first. */
export const KIT_LEVELS = ["FULL", "GOOD", "HALF", "LOW", "EMPTY"] as const;
/** A tool's condition, in the order a cleaner is offered them. */
export const KIT_CONDITIONS = ["AVAILABLE", "MISSING", "DAMAGED", "NEEDS_REPLACEMENT", "NEEDS_MAINTENANCE"] as const;
/** What happened to an item. They mean different things to the books: see the issue endpoint. */
export const KIT_ISSUE_TYPES = ["LOST", "BROKEN", "RAN_OUT", "OTHER"] as const;
/** What happened to one line of a restock request. */
export const KIT_REQUEST_OUTCOMES = ["CREATED", "ALREADY_PENDING"] as const;

export type KitCondition = (typeof KIT_CONDITIONS)[number];
export type KitIssueType = (typeof KIT_ISSUE_TYPES)[number];

/** Kit counts are whole units, and a count above this is a typo, not a recount. */
export const KIT_MAX_QUANTITY = 1000;
const Note = z.string().trim().max(300);

/** One item in the cleaner's kit. */
export const KitItem = z.object({
  productId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  /** "bottles", "cloths". */
  unit: z.string(),
  /** What the kit holds on record. Can be fractional for older rows (0.5 L). */
  quantity: z.number(),
  itemType: openEnum(KIT_ITEM_TYPES),
  /**
   * The cleaner's restock point: at or below it, the item is low. Null for a
   * tool, which never runs low however many there are.
   */
  refillAt: z.number().nullable(),
  /**
   * THE state of this item, computed by the server with the web's rule. The
   * app shows `label` and paints by `tone`; it never re-derives "is this low".
   */
  attention: z.object({
    kind: openEnum(KIT_ATTENTION_KINDS),
    tone: openEnum(KIT_TONES),
    /** Ready to show: "Low", "Empty", "Half", "Damaged". */
    label: z.string(),
    needsAttention: z.boolean(),
  }),
  /** A liquid's last reported level, when anyone has reported one. */
  level: openEnum(KIT_LEVELS).nullable(),
  /** A tool's last reported condition, when anyone has reported one. */
  condition: openEnum(KIT_CONDITIONS).nullable(),
  /** The cleaner's own note with the last condition report. */
  statusNote: z.string().nullable(),
  statusUpdatedAt: Instant.nullable(),
  updatedAt: Instant,
  /** An open restock request for this item, so it isn't asked for twice. */
  pendingRequest: z.object({ quantity: z.number(), requestedAt: Instant }).nullable(),
});
export type KitItem = z.infer<typeof KitItem>;

/**
 * GET /api/v1/kit — the caller's kit, sorted by name.
 *
 * Server: staff only; `employeeProduct` rows WHERE employeeId = session user.
 * `attention` uses the CLEANER restock threshold with the company default
 * (`loadCleanerThresholdDefault`), never the warehouse reorder point.
 */
export const KitResponse = z.object({
  items: z.array(KitItem),
  /** How many items need attention: the More row's "2 LOW". */
  needsAttention: z.number().int(),
});
export type KitResponse = z.infer<typeof KitResponse>;

/**
 * GET /api/v1/kit/catalog — products the caller can add as "already have it":
 * every active (not archived) product that is NOT already in their kit.
 * Name and unit only; no stock levels or prices.
 */
export const KitCatalogResponse = z.object({
  items: z.array(z.object({ productId: z.string(), name: z.string(), unit: z.string() })),
});
export type KitCatalogResponse = z.infer<typeof KitCatalogResponse>;

/**
 * POST /api/v1/kit/items — record an item the cleaner already has on hand
 * (their starting inventory). Idempotent on `clientEventId`.
 *
 * Server: creates the caller's kit row only (company stock is untouched) and
 * writes a RECOUNT audit row, exactly as `addMyInventoryItem`. The product
 * must be assignable (`findAssignableProduct`). Already in the kit → 409
 * `ALREADY_IN_KIT` ("Already in your kit — update the count instead").
 * Returns the new item.
 */
export const KitAddRequest = z.object({
  clientEventId: z.uuid(),
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(KIT_MAX_QUANTITY),
});
export type KitAddRequest = z.infer<typeof KitAddRequest>;

/**
 * PUT /api/v1/kit/items/:productId/count — a recount of the caller's own item.
 * Idempotent on `clientEventId`, and saving the number already on record is
 * a no-op with no audit row.
 *
 * Server: as `updateMyInventoryCount` — the caller's kit row only, company
 * stock untouched, a RECOUNT audit row carrying the reason. Returns the item.
 */
export const KitCountRequest = z.object({
  clientEventId: z.uuid(),
  quantity: z.number().int().min(0).max(KIT_MAX_QUANTITY),
  /** Required: the office sees why the count changed. */
  reason: Note.min(1),
});
export type KitCountRequest = z.infer<typeof KitCountRequest>;

/**
 * PUT /api/v1/kit/items/:productId/condition — how a TOOL is. Idempotent on
 * `clientEventId`.
 *
 * Server: as `updateMyItemCondition`. Only for REUSABLE_EQUIPMENT (anything
 * else → 409 `NOT_EQUIPMENT`). Moves no stock. Writes the status report, and
 * opens one review flag per (cleaner, product, type) for anything but
 * AVAILABLE, resolving the others. Returns the item.
 */
export const KitConditionRequest = z.object({
  clientEventId: z.uuid(),
  condition: z.enum(KIT_CONDITIONS),
  note: Note.nullable().optional(),
});
export type KitConditionRequest = z.infer<typeof KitConditionRequest>;

/**
 * POST /api/v1/kit/items/:productId/issues — something happened to an item.
 * Idempotent on `clientEventId`: a retry must not write stock off twice.
 *
 * Server: as `reportDamagedItem`. `quantity` may not exceed what the kit holds
 * (400 otherwise). LOST and BROKEN are written off company stock as well as
 * the kit; RAN_OUT and OTHER reduce the kit only (RAN_OUT flags a restock,
 * OTHER flags for review). For a tool, LOST sets MISSING and BROKEN sets
 * DAMAGED. Returns the item as it now stands.
 */
export const KitIssueRequest = z.object({
  clientEventId: z.uuid(),
  type: z.enum(KIT_ISSUE_TYPES),
  quantity: z.number().int().min(1).max(KIT_MAX_QUANTITY),
  note: Note.nullable().optional(),
});
export type KitIssueRequest = z.infer<typeof KitIssueRequest>;

/**
 * POST /api/v1/kit/requests — ask the office to restock one or more items.
 * Idempotent on `clientEventId`.
 *
 * Server: as `createInventoryRequest`, once per line, in one transaction. Each
 * product must be assignable. A product with a PENDING request from this
 * caller is not requested again (`ALREADY_PENDING`), so a retry or a second tap
 * never puts a duplicate in front of the office. One LOW_INVENTORY alert per
 * created line. Duplicate productIds in one request → 400.
 */
export const KitRestockRequest = z.object({
  clientEventId: z.uuid(),
  items: z
    .array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(KIT_MAX_QUANTITY) }))
    .min(1)
    .max(50),
  note: Note.nullable().optional(),
});
export type KitRestockRequest = z.infer<typeof KitRestockRequest>;

export const KitRestockResponse = z.object({
  results: z.array(z.object({ productId: z.string(), outcome: openEnum(KIT_REQUEST_OUTCOMES) })),
});
export type KitRestockResponse = z.infer<typeof KitRestockResponse>;

/** A storage location a cleaner can pick up from. */
export const KitLocation = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string().nullable(),
});
export type KitLocation = z.infer<typeof KitLocation>;

/** GET /api/v1/kit/locations — active storage locations, by name. */
export const KitLocationsResponse = z.object({ items: z.array(KitLocation) });
export type KitLocationsResponse = z.infer<typeof KitLocationsResponse>;

/**
 * GET /api/v1/kit/locations/:locationId/products — what can be picked up
 * there: EVERY active product, with what the location has on record (which
 * can be 0 or below; it is an estimate, never a block). As
 * `getLocationProducts`. An inactive location → 404.
 */
export const KitLocationProductsResponse = z.object({
  location: KitLocation,
  items: z.array(
    z.object({
      productId: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      unit: z.string(),
      /** On record at this location. */
      available: z.number(),
    }),
  ),
});
export type KitLocationProductsResponse = z.infer<typeof KitLocationProductsResponse>;

/**
 * POST /api/v1/kit/pickups — "I took these from storage". Idempotent on
 * `clientEventId`: a retry must not add the items to the kit twice.
 *
 * Server: as `checkoutInventory`, in one transaction: decrements the
 * location's stock (low stock is a warning, never a refusal), adds to the
 * CALLER'S kit, and writes PICKUP audit rows on both sides. Products must
 * exist and not be archived; duplicate productIds → 400.
 */
export const KitPickupRequest = z.object({
  clientEventId: z.uuid(),
  locationId: z.string().min(1),
  items: z
    .array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(KIT_MAX_QUANTITY) }))
    .min(1)
    .max(50),
  note: Note.nullable().optional(),
});
export type KitPickupRequest = z.infer<typeof KitPickupRequest>;

export const KitPickupResponse = z.object({
  pickupId: z.string(),
  /** Lines where the location had less on record than was taken; the office reconciles them. */
  warnings: z.array(z.string()),
});
export type KitPickupResponse = z.infer<typeof KitPickupResponse>;
