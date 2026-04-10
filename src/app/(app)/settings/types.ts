export interface SettingsUser {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: "OWNER" | "ADMIN" | "EMPLOYEE";
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

export interface InventoryRuleRecord {
  id: string;
  productId: string;
  usagePerJob: number;
  refillThreshold: number;
  product: ProductRecord;
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
  contact: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  prices: SupplierPriceRecord[];
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
