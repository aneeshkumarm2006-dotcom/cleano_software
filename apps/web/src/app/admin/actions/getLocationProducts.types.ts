export type LocationProductEntry = {
  productId: string;
  productName: string;
  productDescription: string | null;
  unit: string;
  /** Stock recorded at this location. May be 0 or negative — never a gate. */
  available: number;
  /** Restock threshold, used to label a product "low stock" in the picker. */
  minStock: number;
};
