export interface SettingsUser {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  /**
   * Every staff role, not just the three this used to name. The page is shared
   * (decision D6) and an OPS_MANAGER or FIELD_LEAD opening their own settings
   * used to be cast to "EMPLOYEE" here — a lie that made `user.role === "EMPLOYEE"`
   * checks in ProfileTab read as true for people who are not cleaners.
   */
  role: "OWNER" | "ADMIN" | "OPS_MANAGER" | "FIELD_LEAD" | "EMPLOYEE";
}

/**
 * A settings section whose query failed. The page degrades that section to its
 * empty state and passes this through instead of throwing, so one unreachable
 * table can no longer take down every other tab.
 */
export interface SettingsSectionFailure {
  /** The data prop that could not be loaded, e.g. "trainingModules". */
  key: string;
  /** What the admin is shown, e.g. "Training modules". */
  label: string;
}

export interface AppSettingRecord {
  id: string;
  key: string;
  category: string;
  value: unknown;
}

export interface ProductRecord {
  id: string;
  name: string;
  unit: string;
  costPerUnit: number;
  stockLevel: number;
  minStock: number;
}

export interface KitTemplateRecord {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  items: {
    id: string;
    productId: string;
    quantity: number;
    product: ProductRecord;
  }[];
}

export interface SupplierPriceRecord {
  id: string;
  supplierId: string;
  productId: string;
  price: number;
  unit: string | null;
  notes: string | null;
  product: ProductRecord;
}

export interface SupplierRecord {
  id: string;
  name: string;
  website: string | null;
  contact: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  prices: SupplierPriceRecord[];
}

export interface ChecklistTemplateItemRecord {
  id: string;
  templateId: string;
  title: string;
  description: string | null;
  isRequired: boolean;
  sortOrder: number;
}

export interface ChecklistTemplateRecord {
  id: string;
  name: string;
  description: string | null;
  jobType: string | null;
  addOnName: string | null;
  /** Customer scope (Stage 10 / PDF #10). Null = not customer-specific. */
  clientId: string | null;
  clientAddressId: string | null;
  /** Joined for the scope chip, so the list needs no second lookup. */
  client: { id: string; name: string } | null;
  clientAddress: { id: string; label: string; address: string } | null;
  isActive: boolean;
  items: ChecklistTemplateItemRecord[];
}

export interface InventoryLocationStockRecord {
  id: string;
  locationId: string;
  productId: string;
  quantity: number;
}

export interface InventoryLocationRecord {
  id: string;
  name: string;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  stock: InventoryLocationStockRecord[];
}

export interface ServiceAreaRecord {
  id: string;
  prefix: string;
  zoneName: string;
  isActive: boolean;
  travelFee: number;
  notes: string | null;
}

// Helpers to read AppSetting values by key with a fallback
export function getSetting<T>(
  settings: AppSettingRecord[],
  key: string,
  fallback: T
): T {
  const found = settings.find((s) => s.key === key);
  return (found?.value as T) ?? fallback;
}
