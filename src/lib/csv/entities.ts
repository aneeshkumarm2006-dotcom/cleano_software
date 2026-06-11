// Per-entity CSV import configuration + isomorphic validation.
// Imported by BOTH the client import UI (template download, preview validation,
// unknown-column detection) and the server import action (authoritative re-validation).
// Keep this file free of any server-only imports so it stays usable in the browser.

import { unparseCsv } from "./parse";

export type EntityKey =
  | "clients"
  | "jobs"
  | "employees"
  | "products"
  | "suppliers"
  | "inventory-rules"
  | "inventory-locations"
  | "inventory-requests"
  | "kit-templates";

export type ColType = "string" | "int" | "float" | "boolean" | "enum";

export interface CsvColumn {
  key: string;
  type: ColType;
  required?: boolean;
  enumValues?: readonly string[];
  example: string;
  help?: string;
  min?: number;
  max?: number;
  /** Alternate header names accepted from uploads (e.g. "Full Name" → name). Matched loosely. */
  aliases?: readonly string[];
}

export interface CsvEntityConfig {
  key: EntityKey;
  title: string;
  fileName: string;
  description: string;
  guidance: string[];
  columns: CsvColumn[];
  /** Headers we knowingly ignore (so they don't trigger the "unknown column" banner). */
  ignoredHeaders?: readonly string[];
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const CLIENT_TYPES = ["RESIDENTIAL", "COMMERCIAL"] as const;
const SERVICE_FREQ = ["ONE_TIME", "WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY"] as const;
const JOB_STATUS = ["CREATED", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "PAID", "CANCELLED"] as const;
const PAYMENT_TYPES = ["CASH", "CHEQUE", "E_TRANSFER", "CREDIT_CARD", "OTHER"] as const;
const ROLES = ["OWNER", "ADMIN", "OPS_MANAGER", "FIELD_LEAD", "EMPLOYEE", "CLIENT"] as const;
const PRODUCT_CATEGORIES = ["LIQUID_SPRAY", "MOP_LIQUID", "DISPOSABLE", "OTHER"] as const;
const REQUEST_STATUS = ["PENDING", "APPROVED", "REJECTED", "FULFILLED"] as const;

export const CSV_ENTITIES: Record<EntityKey, CsvEntityConfig> = {
  clients: {
    key: "clients",
    title: "Clients",
    fileName: "clients-template.csv",
    description: "Import customer records.",
    guidance: ["Rows are skipped as duplicates when their email matches an existing client."],
    ignoredHeaders: ["Id", "First Name", "Last Name"],
    columns: [
      { key: "name", type: "string", required: true, example: "Jane Doe", aliases: ["Full Name"] },
      { key: "email", type: "string", example: "jane@example.com", help: "Used to detect duplicates", aliases: ["Email Address"] },
      { key: "secondaryEmail", type: "string", example: "", aliases: ["Additional Email Addresse(s)", "Additional Email Addresses", "Additional Email Address"] },
      { key: "phone", type: "string", example: "+1 555 123 4567", aliases: ["Phone Number"] },
      { key: "secondaryPhone", type: "string", example: "", aliases: ["Additional Phone Number(s)", "Additional Phone Numbers", "Additional Phone Number"] },
      { key: "company", type: "string", example: "", aliases: ["Company Name"] },
      { key: "address", type: "string", example: "12 Main St, Toronto" },
      { key: "aptNumber", type: "string", example: "4B", aliases: ["Apt. No.", "Apt No", "Apt", "Unit"] },
      { key: "city", type: "string", example: "Toronto" },
      { key: "state", type: "string", example: "ON", aliases: ["Province", "State/Province"] },
      { key: "zip", type: "string", example: "M5V 2T6", aliases: ["Zip/Postal Code", "Postal Code", "Zip Code", "Zip", "Postal"] },
      { key: "notes", type: "string", example: "", aliases: ["Note"] },
      { key: "discountPercent", type: "float", min: 0, max: 100, example: "10" },
      { key: "clientType", type: "enum", enumValues: CLIENT_TYPES, example: "RESIDENTIAL" },
      { key: "serviceFrequency", type: "enum", enumValues: SERVICE_FREQ, example: "WEEKLY" },
      { key: "isActive", type: "boolean", example: "true", help: "true/false, or Active/Inactive", aliases: ["Status"] },
    ],
  },

  jobs: {
    key: "jobs",
    title: "Jobs",
    fileName: "jobs-template.csv",
    description: "Import jobs/bookings.",
    guidance: [
      "clientEmail links to an existing client; otherwise the client is matched by clientName.",
      "startDate uses YYYY-MM-DD and startTime uses 24h HH:MM.",
      "cleanerEmails is a semicolon-separated list of existing employee emails.",
      "A row is skipped as duplicate when a job for the same clientName + start time already exists.",
    ],
    columns: [
      { key: "clientName", type: "string", required: true, example: "Jane Doe" },
      { key: "clientEmail", type: "string", example: "jane@example.com", help: "Links to an existing client by email" },
      { key: "startDate", type: "string", required: true, example: "2026-06-15", help: "YYYY-MM-DD" },
      { key: "startTime", type: "string", required: true, example: "09:00", help: "24h HH:MM" },
      { key: "endDate", type: "string", example: "2026-06-15", help: "YYYY-MM-DD" },
      { key: "endTime", type: "string", example: "11:00", help: "24h HH:MM" },
      { key: "location", type: "string", example: "12 Main St" },
      { key: "aptNumber", type: "string", example: "4B" },
      { key: "description", type: "string", example: "" },
      { key: "jobType", type: "string", example: "Standard Clean" },
      { key: "status", type: "enum", enumValues: JOB_STATUS, example: "SCHEDULED" },
      { key: "price", type: "float", min: 0, example: "120" },
      { key: "employeePay", type: "float", min: 0, example: "60" },
      { key: "totalTip", type: "float", min: 0, example: "0" },
      { key: "parking", type: "float", min: 0, example: "0" },
      { key: "discountAmount", type: "float", min: 0, example: "0" },
      { key: "paymentType", type: "enum", enumValues: PAYMENT_TYPES, example: "E_TRANSFER" },
      { key: "paymentReceived", type: "boolean", example: "false" },
      { key: "invoiceSent", type: "boolean", example: "false" },
      { key: "bedCount", type: "int", min: 0, example: "2" },
      { key: "bathCount", type: "int", min: 0, example: "1" },
      { key: "halfBathCount", type: "int", min: 0, example: "0" },
      { key: "payRateMultiplier", type: "float", min: 0, example: "1.0" },
      { key: "requiredCleaners", type: "int", min: 1, example: "1" },
      { key: "employeeEmail", type: "string", example: "", help: "Assigned/owning employee by email" },
      { key: "cleanerEmails", type: "string", example: "", help: "Semicolon-separated cleaner emails" },
      { key: "notes", type: "string", example: "" },
    ],
  },

  employees: {
    key: "employees",
    title: "Employees",
    fileName: "employees-template.csv",
    description: "Import staff/cleaner accounts.",
    guidance: [
      "A password is auto-generated and an invite email is sent; new staff set their own password via the reset link.",
      "Rows are skipped as duplicates when their email matches an existing account.",
      "role defaults to EMPLOYEE if left blank.",
    ],
    columns: [
      { key: "name", type: "string", required: true, example: "Alex Smith" },
      { key: "email", type: "string", required: true, example: "alex@example.com", help: "Login + duplicate detection" },
      { key: "role", type: "enum", enumValues: ROLES, example: "EMPLOYEE" },
      { key: "phone", type: "string", example: "+1 555 222 3333" },
      { key: "payMultiplier", type: "float", min: 0, example: "1.0" },
    ],
  },

  products: {
    key: "products",
    title: "Products",
    fileName: "products-template.csv",
    description: "Import inventory products.",
    guidance: ["Rows are skipped as duplicates when their name matches an existing product (case-insensitive)."],
    columns: [
      { key: "name", type: "string", required: true, example: "Glass Cleaner" },
      { key: "unit", type: "string", required: true, example: "bottles" },
      { key: "costPerUnit", type: "float", required: true, min: 0, example: "5.99" },
      { key: "description", type: "string", example: "" },
      { key: "stockLevel", type: "float", min: 0, example: "0" },
      { key: "minStock", type: "float", min: 0, example: "0" },
      { key: "category", type: "enum", enumValues: PRODUCT_CATEGORIES, example: "OTHER" },
    ],
  },

  suppliers: {
    key: "suppliers",
    title: "Suppliers",
    fileName: "suppliers-template.csv",
    description: "Import suppliers.",
    guidance: ["Rows are skipped as duplicates when their name matches an existing supplier (case-insensitive)."],
    columns: [
      { key: "name", type: "string", required: true, example: "Acme Supplies" },
      { key: "contact", type: "string", example: "John Buyer" },
      { key: "email", type: "string", example: "sales@acme.com" },
      { key: "phone", type: "string", example: "+1 555 000 1111" },
      { key: "address", type: "string", example: "" },
      { key: "notes", type: "string", example: "" },
      { key: "isActive", type: "boolean", example: "true" },
    ],
  },

  "inventory-rules": {
    key: "inventory-rules",
    title: "Inventory Rules",
    fileName: "inventory-rules-template.csv",
    description: "Import per-product usage/refill rules.",
    guidance: [
      "productName must match an existing product. Rows referencing an unknown product fail.",
      "Rows are skipped when the product already has a rule.",
    ],
    columns: [
      { key: "productName", type: "string", required: true, example: "Glass Cleaner", help: "Must match an existing product" },
      { key: "usagePerJob", type: "float", required: true, min: 0, example: "1" },
      { key: "refillThreshold", type: "float", required: true, min: 0, example: "5" },
    ],
  },

  "inventory-locations": {
    key: "inventory-locations",
    title: "Inventory Locations",
    fileName: "inventory-locations-template.csv",
    description: "Import storage locations.",
    guidance: ["Rows are skipped as duplicates when their name matches an existing location (case-insensitive)."],
    columns: [
      { key: "name", type: "string", required: true, example: "Main Warehouse" },
      { key: "address", type: "string", example: "100 Depot Rd" },
      { key: "notes", type: "string", example: "" },
      { key: "isActive", type: "boolean", example: "true" },
    ],
  },

  "inventory-requests": {
    key: "inventory-requests",
    title: "Inventory Requests",
    fileName: "inventory-requests-template.csv",
    description: "Import equipment/inventory requests on behalf of staff.",
    guidance: [
      "employeeEmail must match an existing employee.",
      "Provide exactly ONE of productName or kitName (both must reference existing records).",
      "Requests are not de-duplicated — every valid row creates a new request.",
    ],
    columns: [
      { key: "employeeEmail", type: "string", required: true, example: "alex@example.com" },
      { key: "productName", type: "string", example: "Glass Cleaner", help: "Provide productName OR kitName" },
      { key: "kitName", type: "string", example: "", help: "Provide productName OR kitName" },
      { key: "quantity", type: "float", required: true, min: 0, example: "2" },
      { key: "reason", type: "string", example: "Ran out on site" },
      { key: "status", type: "enum", enumValues: REQUEST_STATUS, example: "PENDING" },
    ],
  },

  "kit-templates": {
    key: "kit-templates",
    title: "Cleaner Kits",
    fileName: "cleaner-kits-template.csv",
    description: "Import reusable cleaner kit templates.",
    guidance: [
      "items format: product:qty; product:qty — e.g. Glass Cleaner:2; Mop Solution:1",
      "Every product referenced in items must already exist, or the row fails.",
      "Rows are skipped as duplicates when their name matches an existing kit (case-insensitive).",
    ],
    columns: [
      { key: "name", type: "string", required: true, example: "Starter Kit" },
      { key: "description", type: "string", example: "" },
      { key: "isActive", type: "boolean", example: "true" },
      { key: "items", type: "string", required: true, example: "Glass Cleaner:2; Mop Solution:1", help: "product:qty; product:qty" },
    ],
  },
};

// ---------------------------------------------------------------------------
// Validation / coercion
// ---------------------------------------------------------------------------

const TRUE_VALUES = ["true", "yes", "y", "1", "active"];
const FALSE_VALUES = ["false", "no", "n", "0", "inactive"];

// Normalize a header for matching: lowercase, drop everything that isn't a
// letter or digit. So "Apt. No.", "Zip/Postal Code", "Full Name*" all collapse
// to a stable comparable form and match their column key or an alias.
function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** All normalized header forms a column will accept (its key + any aliases). */
function columnAcceptedNames(col: CsvColumn): string[] {
  return [col.key, ...(col.aliases ?? [])].map(normalizeHeader);
}

/** Look up a column's value from a parsed record, matching by key or any alias. */
function lookupValue(record: Record<string, string>, col: CsvColumn): string {
  const accepted = columnAcceptedNames(col);
  for (const k of Object.keys(record)) {
    if (accepted.includes(normalizeHeader(k))) return record[k];
  }
  return "";
}

type CoerceResult = { ok: true; value: unknown } | { ok: false; error: string };

function coerceCell(col: CsvColumn, raw: string): CoerceResult {
  const v = (raw ?? "").trim();
  if (v === "") {
    if (col.required) return { ok: false, error: `${col.key} is required` };
    return { ok: true, value: undefined };
  }
  switch (col.type) {
    case "string":
      return { ok: true, value: v };
    case "int": {
      const n = Number(v);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        return { ok: false, error: `${col.key} must be a whole number` };
      }
      if (col.min != null && n < col.min) return { ok: false, error: `${col.key} must be ≥ ${col.min}` };
      if (col.max != null && n > col.max) return { ok: false, error: `${col.key} must be ≤ ${col.max}` };
      return { ok: true, value: n };
    }
    case "float": {
      const n = Number(v);
      if (!Number.isFinite(n)) return { ok: false, error: `${col.key} must be a number` };
      if (col.min != null && n < col.min) return { ok: false, error: `${col.key} must be ≥ ${col.min}` };
      if (col.max != null && n > col.max) return { ok: false, error: `${col.key} must be ≤ ${col.max}` };
      return { ok: true, value: n };
    }
    case "boolean": {
      const t = v.toLowerCase();
      if (TRUE_VALUES.includes(t)) return { ok: true, value: true };
      if (FALSE_VALUES.includes(t)) return { ok: true, value: false };
      return { ok: false, error: `${col.key} must be true or false` };
    }
    case "enum": {
      const match = col.enumValues?.find((e) => e.toLowerCase() === v.toLowerCase());
      if (!match) return { ok: false, error: `${col.key} must be one of: ${col.enumValues?.join(", ")}` };
      return { ok: true, value: match };
    }
    default:
      return { ok: true, value: v };
  }
}

export interface ValidatedRow {
  values: Record<string, unknown>;
  errors: string[];
}

/** Validate a parsed record against an entity config; returns coerced values + format errors. */
export function validateRecord(config: CsvEntityConfig, record: Record<string, string>): ValidatedRow {
  const values: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const col of config.columns) {
    const res = coerceCell(col, lookupValue(record, col));
    if (res.ok) {
      if (res.value !== undefined) values[col.key] = res.value;
    } else {
      errors.push(res.error);
    }
  }
  return { values, errors };
}

/** Headers present in the upload that the entity config does not recognize. */
export function findUnknownColumns(config: CsvEntityConfig, headers: string[]): string[] {
  const known = new Set<string>();
  for (const col of config.columns) for (const n of columnAcceptedNames(col)) known.add(n);
  for (const h of config.ignoredHeaders ?? []) known.add(normalizeHeader(h));
  return headers.filter((h) => h.trim() !== "" && !known.has(normalizeHeader(h)));
}

/** Build the downloadable template CSV (header row + one example row). */
export function buildTemplateCsv(config: CsvEntityConfig): string {
  const headers = config.columns.map((c) => (c.required ? `${c.key}*` : c.key));
  const example = config.columns.map((c) => c.example);
  return unparseCsv([headers, example]);
}
