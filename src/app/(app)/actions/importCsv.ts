"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { hashPassword } from "better-auth/crypto";
import { randomBytes } from "crypto";
import { sendAccountEmail } from "@/lib/email";
import { syncDefaultLocationStock } from "@/lib/inventory";
import { CSV_ENTITIES, validateRecord, type EntityKey } from "@/lib/csv/entities";

export interface RowResult {
  row: number; // 1-based data row number (excludes header)
  status: "created" | "skipped" | "failed";
  reason?: string;
  label?: string;
}

export interface ImportResponse {
  ok: boolean;
  error?: string;
  results: RowResult[];
  summary: { created: number; skipped: number; failed: number; total: number };
}

const MAX_ROWS = 2000;
// How many rows to process in parallel. Keeps the pooled DB connection busy
// without overwhelming it, turning ~1,400 sequential round-trips into ~waves.
const CONCURRENCY = 8;

type Values = Record<string, unknown>;
type HandlerOutcome = { status: RowResult["status"]; reason?: string; label?: string };
type Handler = (v: Values) => Promise<HandlerOutcome>;

const REVALIDATE: Record<EntityKey, string[]> = {
  clients: ["/clients"],
  jobs: ["/jobs", "/analytics"],
  employees: ["/employees"],
  products: ["/inventory"],
  suppliers: ["/settings"],
  "inventory-rules": ["/settings"],
  "inventory-locations": ["/settings", "/inventory", "/my-inventory"],
  "inventory-requests": ["/inventory", "/my-inventory"],
  "kit-templates": ["/settings"],
};

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Not authenticated" as const };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") return { error: "Not authorized" as const };
  return { session };
}

// --- relation/date helpers -------------------------------------------------

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
  return s === "" ? null : s;
};

function normalizeTime(ts: string): string {
  const m = ts.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return "00:00:00";
  return `${m[1].padStart(2, "0")}:${m[2]}:${m[3] || "00"}`;
}

function combineDateTime(dateStr: unknown, timeStr: unknown): Date | null {
  const ds = str(dateStr);
  if (!ds) return null;
  const ts = str(timeStr) || "00:00";
  const d = new Date(`${ds}T${normalizeTime(ts)}`);
  if (!isNaN(d.getTime())) return d;
  const d2 = new Date(`${ds} ${ts}`);
  return isNaN(d2.getTime()) ? null : d2;
}

// --- per-entity handlers ---------------------------------------------------

const clientsHandler: Handler = async (v) => {
  const name = v.name as string;
  const email = str(v.email);
  if (email) {
    const existing = await db.client.findFirst({ where: { email } });
    if (existing) return { status: "skipped", reason: `Client with email ${email} already exists`, label: name };
  }
  await db.client.create({
    data: {
      name,
      email,
      secondaryEmail: str(v.secondaryEmail),
      phone: str(v.phone),
      secondaryPhone: str(v.secondaryPhone),
      company: str(v.company),
      address: str(v.address),
      aptNumber: str(v.aptNumber),
      city: str(v.city),
      state: str(v.state),
      zip: str(v.zip),
      notes: str(v.notes),
      discountPercent: (v.discountPercent as number) ?? 0,
      clientType: (v.clientType as never) ?? undefined,
      serviceFrequency: (v.serviceFrequency as never) ?? undefined,
      isActive: (v.isActive as boolean) ?? undefined,
    },
  });
  return { status: "created", label: name };
};

const jobsHandler: Handler = async (v) => {
  const clientName = v.clientName as string;
  const clientEmail = str(v.clientEmail);

  let clientId: string | null = null;
  if (clientEmail) {
    const c = await db.client.findFirst({ where: { email: clientEmail } });
    if (c) clientId = c.id;
  }
  if (!clientId) {
    const c = await db.client.findFirst({ where: { name: { equals: clientName, mode: "insensitive" } } });
    if (c) clientId = c.id;
  }

  const startTime = combineDateTime(v.startDate, v.startTime);
  if (!startTime) return { status: "failed", reason: "Invalid startDate/startTime", label: clientName };

  let endTime: Date | null = null;
  if (str(v.endDate) || str(v.endTime)) {
    endTime = combineDateTime(str(v.endDate) || v.startDate, str(v.endTime) || "00:00");
  }

  const dup = await db.job.findFirst({ where: { clientName, startTime } });
  if (dup) {
    return { status: "skipped", reason: `Job for ${clientName} at that start time already exists`, label: clientName };
  }

  let employeeId: string | null = null;
  if (str(v.employeeEmail)) {
    const u = await db.user.findUnique({ where: { email: str(v.employeeEmail)! } });
    if (!u) return { status: "failed", reason: `Employee email ${v.employeeEmail} not found`, label: clientName };
    employeeId = u.id;
  }

  const cleanerConnect: { id: string }[] = [];
  if (str(v.cleanerEmails)) {
    const emails = String(v.cleanerEmails)
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const em of emails) {
      const u = await db.user.findUnique({ where: { email: em } });
      if (!u) return { status: "failed", reason: `Cleaner email ${em} not found`, label: clientName };
      cleanerConnect.push({ id: u.id });
    }
  }

  await db.job.create({
    data: {
      clientName,
      clientId,
      employeeId,
      location: str(v.location),
      aptNumber: str(v.aptNumber),
      description: str(v.description),
      jobType: str(v.jobType),
      startTime,
      endTime,
      jobDate: startTime,
      status: (v.status as never) ?? undefined,
      price: (v.price as number) ?? null,
      employeePay: (v.employeePay as number) ?? null,
      totalTip: (v.totalTip as number) ?? null,
      parking: (v.parking as number) ?? null,
      discountAmount: (v.discountAmount as number) ?? null,
      paymentType: (v.paymentType as never) ?? null,
      paymentReceived: (v.paymentReceived as boolean) ?? undefined,
      invoiceSent: (v.invoiceSent as boolean) ?? undefined,
      bedCount: (v.bedCount as number) ?? null,
      bathCount: (v.bathCount as number) ?? null,
      halfBathCount: (v.halfBathCount as number) ?? null,
      payRateMultiplier: (v.payRateMultiplier as number) ?? undefined,
      requiredCleaners: (v.requiredCleaners as number) ?? undefined,
      notes: str(v.notes),
      cleaners: cleanerConnect.length ? { connect: cleanerConnect } : undefined,
    },
  });
  return { status: "created", label: clientName };
};

const employeesHandler: Handler = async (v) => {
  const email = (v.email as string).trim();
  const name = v.name as string;
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return { status: "skipped", reason: `Employee ${email} already exists`, label: email };

  const role = (v.role as string) || "EMPLOYEE";
  const password = randomBytes(12).toString("base64url");
  const hashed = await hashPassword(password);

  const user = await db.user.create({
    data: {
      name,
      email,
      phone: str(v.phone),
      emailVerified: true,
      role: role as never,
      payMultiplier: (v.payMultiplier as number) ?? undefined,
    },
  });
  await db.account.create({
    data: { userId: user.id, accountId: user.id, providerId: "credential", password: hashed },
  });

  const sendRole = role === "CLIENT" ? "CUSTOMER" : "PROVIDER";
  sendAccountEmail({ to: email, name, role: sendRole, event: "new_account" }).catch((e) =>
    console.error("import new_account email", e)
  );
  if (sendRole === "PROVIDER") {
    sendAccountEmail({ to: email, name, role: "PROVIDER", event: "how_it_works" }).catch((e) =>
      console.error("import how_it_works email", e)
    );
  }
  sendAccountEmail({ to: email, name, role: sendRole, event: "activated" }).catch((e) =>
    console.error("import activated email", e)
  );

  return { status: "created", label: email };
};

const productsHandler: Handler = async (v) => {
  const name = v.name as string;
  const existing = await db.product.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (existing) return { status: "skipped", reason: `Product "${name}" already exists`, label: name };

  const stockLevel = (v.stockLevel as number) ?? 0;
  const product = await db.product.create({
    data: {
      name,
      description: str(v.description),
      unit: v.unit as string,
      costPerUnit: v.costPerUnit as number,
      stockLevel,
      minStock: (v.minStock as number) ?? 0,
      category: (v.category as never) ?? undefined,
    },
  });
  await syncDefaultLocationStock(product.id, stockLevel);
  return { status: "created", label: name };
};

const suppliersHandler: Handler = async (v) => {
  const name = v.name as string;
  const existing = await db.supplier.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (existing) return { status: "skipped", reason: `Supplier "${name}" already exists`, label: name };

  await db.supplier.create({
    data: {
      name,
      contact: str(v.contact),
      email: str(v.email),
      phone: str(v.phone),
      address: str(v.address),
      notes: str(v.notes),
      isActive: (v.isActive as boolean) ?? true,
    },
  });
  return { status: "created", label: name };
};

const inventoryRulesHandler: Handler = async (v) => {
  const productName = v.productName as string;
  const product = await db.product.findFirst({ where: { name: { equals: productName, mode: "insensitive" } } });
  if (!product) return { status: "failed", reason: `Product "${productName}" not found`, label: productName };

  const existing = await db.inventoryRule.findUnique({ where: { productId: product.id } });
  if (existing) return { status: "skipped", reason: `Rule for "${productName}" already exists`, label: productName };

  await db.inventoryRule.create({
    data: {
      productId: product.id,
      usagePerJob: v.usagePerJob as number,
      refillThreshold: v.refillThreshold as number,
    },
  });
  return { status: "created", label: productName };
};

const inventoryLocationsHandler: Handler = async (v) => {
  const name = v.name as string;
  const existing = await db.inventoryLocation.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (existing) return { status: "skipped", reason: `Location "${name}" already exists`, label: name };

  await db.inventoryLocation.create({
    data: { name, address: str(v.address), notes: str(v.notes), isActive: (v.isActive as boolean) ?? true },
  });
  return { status: "created", label: name };
};

const inventoryRequestsHandler: Handler = async (v) => {
  const email = (v.employeeEmail as string).trim();
  const emp = await db.user.findUnique({ where: { email } });
  if (!emp) return { status: "failed", reason: `Employee ${email} not found`, label: email };

  const qty = v.quantity as number;
  if (!(qty > 0)) return { status: "failed", reason: "quantity must be greater than 0", label: email };

  const productName = str(v.productName);
  const kitName = str(v.kitName);
  if ((productName && kitName) || (!productName && !kitName)) {
    return { status: "failed", reason: "Provide exactly one of productName or kitName", label: email };
  }

  let productId: string | null = null;
  let kitId: string | null = null;
  if (productName) {
    const p = await db.product.findFirst({ where: { name: { equals: productName, mode: "insensitive" } } });
    if (!p) return { status: "failed", reason: `Product "${productName}" not found`, label: email };
    productId = p.id;
  } else {
    const k = await db.kitTemplate.findFirst({ where: { name: { equals: kitName!, mode: "insensitive" } } });
    if (!k) return { status: "failed", reason: `Kit "${kitName}" not found`, label: email };
    kitId = k.id;
  }

  await db.inventoryRequest.create({
    data: {
      employeeId: emp.id,
      productId,
      kitId,
      quantity: qty,
      reason: str(v.reason),
      status: (v.status as never) ?? undefined,
    },
  });
  return { status: "created", label: email };
};

const kitTemplatesHandler: Handler = async (v) => {
  const name = v.name as string;
  const existing = await db.kitTemplate.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (existing) return { status: "skipped", reason: `Kit "${name}" already exists`, label: name };

  const parts = String(v.items || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return { status: "failed", reason: "items is required (format product:qty; product:qty)", label: name };
  }

  const itemsByProduct = new Map<string, { productId: string; quantity: number }>();
  for (const part of parts) {
    const idx = part.lastIndexOf(":");
    if (idx < 0) return { status: "failed", reason: `Bad item "${part}" — use product:qty`, label: name };
    const pname = part.slice(0, idx).trim();
    const qty = Number(part.slice(idx + 1).trim());
    if (!pname || !Number.isFinite(qty) || qty <= 0) {
      return { status: "failed", reason: `Bad item "${part}" — use product:qty`, label: name };
    }
    const product = await db.product.findFirst({ where: { name: { equals: pname, mode: "insensitive" } } });
    if (!product) return { status: "failed", reason: `Product "${pname}" not found`, label: name };
    itemsByProduct.set(product.id, { productId: product.id, quantity: qty });
  }

  await db.kitTemplate.create({
    data: {
      name,
      description: str(v.description),
      isActive: (v.isActive as boolean) ?? true,
      items: { create: [...itemsByProduct.values()] },
    },
  });
  return { status: "created", label: name };
};

const HANDLERS: Record<EntityKey, Handler> = {
  clients: clientsHandler,
  jobs: jobsHandler,
  employees: employeesHandler,
  products: productsHandler,
  suppliers: suppliersHandler,
  "inventory-rules": inventoryRulesHandler,
  "inventory-locations": inventoryLocationsHandler,
  "inventory-requests": inventoryRequestsHandler,
  "kit-templates": kitTemplatesHandler,
};

// --- entry point -----------------------------------------------------------

export async function importCsv(entity: EntityKey, records: Record<string, string>[]): Promise<ImportResponse> {
  const empty = { results: [] as RowResult[], summary: { created: 0, skipped: 0, failed: 0, total: 0 } };

  const guard = await requireAdmin();
  if ("error" in guard) return { ok: false, error: guard.error, ...empty };

  const config = CSV_ENTITIES[entity];
  const handler = HANDLERS[entity];
  if (!config || !handler) return { ok: false, error: "Unknown import type", ...empty };

  if (!Array.isArray(records) || records.length === 0) {
    return { ok: false, error: "No rows to import", ...empty };
  }
  if (records.length > MAX_ROWS) {
    return { ok: false, error: `Too many rows — max ${MAX_ROWS} per import`, ...empty };
  }

  // Process rows with bounded concurrency so a large file finishes in seconds
  // (sequential per-row round-trips to a remote DB is what risks a timeout).
  // Results are written by index to preserve row order in the report.
  const results: RowResult[] = new Array(records.length);
  let cursor = 0;

  async function worker() {
    for (let i = cursor++; i < records.length; i = cursor++) {
      const rowNum = i + 1;
      const { values, errors } = validateRecord(config, records[i]);
      if (errors.length) {
        results[i] = { row: rowNum, status: "failed", reason: errors.join("; ") };
        continue;
      }
      try {
        const outcome = await handler(values);
        results[i] = { row: rowNum, ...outcome };
      } catch (e) {
        // Unique-constraint conflict (e.g. a duplicate slipped past the dedupe
        // check) is a skip, not a failure.
        if ((e as { code?: string })?.code === "P2002") {
          results[i] = { row: rowNum, status: "skipped", reason: "Duplicate — already exists" };
        } else {
          console.error(`importCsv ${entity} row ${rowNum}`, e);
          results[i] = { row: rowNum, status: "failed", reason: "Server error while importing this row" };
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, records.length) }, worker));

  for (const path of REVALIDATE[entity]) revalidatePath(path);

  const summary = {
    created: results.filter((r) => r.status === "created").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
    total: results.length,
  };
  return { ok: true, results, summary };
}
