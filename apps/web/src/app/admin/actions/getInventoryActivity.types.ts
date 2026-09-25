/** One row of the inventory activity log (awer_fixes.pdf item 18). */
export interface InventoryActivityEntry {
  id: string;
  /** ISO timestamp. */
  at: string;
  /** Null when the change was to company/warehouse stock rather than a kit. */
  cleanerId: string | null;
  cleanerName: string | null;
  productId: string;
  productName: string;
  /**
   * Human-readable verb. Comes from the row's stored `InventoryAction` when it
   * has one; rows written before Stage 3 fall back to reading their prose (see
   * `src/lib/inventory-action.ts`).
   */
  action: string;
  /** True when the label was derived from prose rather than stored. */
  actionDerived: boolean;
  /** Status transition, when the row records one (PDF #1's history list). */
  previousStatus: string | null;
  newStatus: string | null;
  /** Signed change. Negative = stock left this holder. */
  quantityChange: number;
  /** The holder's resulting quantity. */
  newQuantity: number;
  unit: string | null;
  /** Free-text note, when the original action recorded one. */
  note: string | null;
  /** Who performed it (admin or the cleaner themselves). */
  byName: string | null;
}

export interface InventoryActivityPage {
  entries: InventoryActivityEntry[];
  /** Cursor for the next page; null when the end has been reached. */
  nextCursor: string | null;
}
