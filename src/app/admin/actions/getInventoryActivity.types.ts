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
  /** Human-readable action derived from the audit row's reason. */
  action: string;
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
