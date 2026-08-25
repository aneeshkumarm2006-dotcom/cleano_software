// Product lookups for cleaner-kit flows (Stage 5 of `_ai_context/TODO.md`,
// cleano_inventory_operations_fixes.pdf #6).
//
// ────────────────────────────────────────────────────────────────────────────
// THE BUG THIS EXISTS TO KILL
//
// p.6 of the PDF: an admin sets Premsai's "Cleaning Rags" from 2 to 0 and the
// save is rejected with **"Product not found."** — while the product is right
// there on screen, in that cleaner's kit.
//
// It was found. It was ARCHIVED. `setCleanerProductQuantity` looked the product
// up with `{ id, deletedAt: null }`, so a soft-deleted product that a cleaner
// still holds could be rendered but never edited — and archiving one is a
// one-click bulk action that has never checked whether anybody holds it.
//
// ────────────────────────────────────────────────────────────────────────────
// THE RULE
//
//   An archived product may be EDITED and REMOVED in a kit, and may never be
//   NEWLY ASSIGNED, requested, or added.
//
// Those are two different lookups, and every kit-touching action has to pick
// one deliberately. Before this module the five sibling actions each guessed:
// three used `findUnique` with no filter at all, one filtered, and the one that
// mattered filtered and produced the error above.
//
//   editing / removing an existing kit row  → `findKitProduct`
//                                             (the KIT ROW is the authority;
//                                              archived is fine)
//   assigning / requesting / adding         → `findAssignableProduct`
//                                             (the CATALOGUE is the authority;
//                                              archived is refused, by name)
//
// The refusal says what is actually wrong and how to undo it. "Product not
// found" for a product the admin is looking at is the part of this bug that
// cost the most time.

import { db } from "@/lib/org-db";
import type { Prisma } from "@prisma/client";
import type { ScopedTx } from "@/lib/db-scoped";

/** `db`, or a transaction client when the lookup belongs inside one. */
export type ProductLookupClient = Prisma.TransactionClient | ScopedTx | typeof db;

/** The fields every kit flow needs: identity, unit for the audit row, status. */
export interface KitProduct {
  id: string;
  name: string;
  unit: string;
  /** Set when the product has been archived (soft-deleted). */
  deletedAt: Date | null;
}

const KIT_PRODUCT_SELECT = {
  id: true,
  name: true,
  unit: true,
  deletedAt: true,
} as const;

/**
 * Look a product up for an operation on a kit row that ALREADY EXISTS —
 * correcting a count, removing an item, recording a return.
 *
 * Deliberately unfiltered: the `EmployeeProduct` row is the thing being edited,
 * and it does not stop existing because the catalogue entry was archived. The
 * caller decides what to do with `deletedAt`; it is returned rather than hidden
 * so the UI can label an archived row instead of failing on it.
 */
export async function findKitProduct(
  productId: string,
  client: ProductLookupClient = db
): Promise<KitProduct | null> {
  return client.product.findUnique({
    where: { id: productId },
    select: KIT_PRODUCT_SELECT,
  });
}

/**
 * Look a product up for an operation that puts it somewhere NEW — assigning it
 * to a cleaner, requesting a refill, a cleaner adding a starting count.
 *
 * Archived products are refused here, which is what stops new orphans forming.
 * The two failures are reported separately on purpose: "no longer stocked" is
 * recoverable (restore it), "not found" is not.
 */
export async function findAssignableProduct(
  productId: string,
  client: ProductLookupClient = db
): Promise<
  { ok: true; product: KitProduct } | { ok: false; error: string }
> {
  const product = await findKitProduct(productId, client);
  if (!product) return { ok: false, error: PRODUCT_NOT_FOUND };
  if (product.deletedAt) {
    return { ok: false, error: archivedProductError(product.name) };
  }
  return { ok: true, product };
}

/** Genuinely absent — no row with that id. */
export const PRODUCT_NOT_FOUND = "Product not found.";

/**
 * Present but archived. Names the product and the way back, because the admin
 * is almost always looking straight at it when this fires.
 */
export function archivedProductError(name: string): string {
  return `"${name}" has been archived and can no longer be assigned. Restore it from Inventory → Archived first.`;
}

/**
 * The kit row itself is gone — someone else removed the item while this screen
 * was open. NOT "product not found": the product is fine, the assignment isn't.
 */
export const KIT_ROW_MISSING =
  "This item is no longer in the cleaner's inventory.";

/**
 * `where` clause for any picker that offers products to ASSIGN.
 *
 * Kept here rather than inlined so the rule "archived products are never newly
 * assignable" is one grep, and so `scripts/verify-stage5-kit-editing.ts` can
 * check the pickers against a single definition.
 */
export const ASSIGNABLE_PRODUCT_WHERE = {
  deletedAt: null,
} satisfies Prisma.ProductWhereInput;
