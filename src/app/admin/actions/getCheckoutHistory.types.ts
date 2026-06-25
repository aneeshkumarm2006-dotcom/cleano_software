export type CheckoutHistoryItem = {
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
};

export type CheckoutHistoryEntry = {
  id: string;
  createdAt: string;
  notes: string | null;
  location: { id: string; name: string; address: string | null };
  items: CheckoutHistoryItem[];
};
