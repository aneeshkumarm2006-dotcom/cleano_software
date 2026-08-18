/**
 * Shared, dependency-light core for the BookingKoala import. Pure parsing +
 * field mapping only — NO database or email.
 *
 * The ONLY consumer is the server action behind the admin "Import from
 * BookingKoala" button (src/app/admin/actions/runBookingKoalaImport.ts).
 *
 * This docstring used to claim `scripts/importBookingKoala.ts` consumed it too,
 * "so the two can never drift". That was never true — the CLI script imports
 * nothing from here and copy-pasted every helper, and the claim is exactly what
 * let it drift for so long (hardcoded 2026 date window, gstAmount/qstAmount
 * pinned to 0, dedupe missing `deletedAt: null`, no Stripe intent id). The
 * script is now stamped DEPRECATED and refuses to write; the admin button is
 * the supported path.
 */
import { randomBytes } from "crypto";
import { addOnKey } from "../checklist-triggers";
import { inferPropertyTypeFromText, type PropertyType } from "../property-type";

// Broad guard window — only rejects clearly-bogus dates, not real bookings.
// Previously hardcoded to Jun 1–Sep 1 2026, which silently dropped every
// booking outside those three months. Widened so the importer accepts whatever
// date range the admin's exported CSV actually covers.
export const RANGE_START = new Date("2015-01-01T00:00:00-05:00");
export const RANGE_END = new Date("2035-01-01T00:00:00-05:00");
export const BOOKING_SOURCE = "bookingkoala_import";

// ── CSV parser (RFC-4180, handles quoted fields with embedded newlines) ──────
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let q = false;
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        q = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      q = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ── value cleaners ───────────────────────────────────────────────────────────
/** Fix common UTF-8-decoded-as-Latin1 mojibake (MontrÃ©al → Montréal). */
export function fixMojibake(s: string): string {
  if (!s || !/[ÃÂâ€]/.test(s)) return s;
  try {
    const fixed = Buffer.from(s, "latin1").toString("utf8");
    return fixed.includes("�") ? s : fixed;
  } catch {
    return s;
  }
}

/** Strip Excel ="…" escaping and surrounding quotes. */
export function unescapeExcel(s: string): string {
  let v = (s ?? "").trim();
  if (v.startsWith("=")) v = v.slice(1);
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  return v.trim();
}

/** Normalize a Canadian postal code → "H3P 2E3". */
export function cleanZip(raw: string): string | null {
  let z = unescapeExcel(raw).replace(/\s+/g, "").toUpperCase();
  if (!z) return null;
  if (z.length === 6) z = z.slice(0, 3) + " " + z.slice(3);
  return z;
}

export function money(raw: string | undefined): number {
  const n = parseFloat(String(raw ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
export function intOrNull(raw: string | undefined): number | null {
  const n = parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}
export function clean(s: string | undefined): string {
  return fixMojibake((s ?? "").trim());
}
export function cleanOrNull(s: string | undefined): string | null {
  const v = clean(s);
  return v === "" ? null : v;
}

/** 12-char readable temp password (no ambiguous chars). */
export function makeTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// ─── Add-ons (awerfixes item 9) ──────────────────────────────────────────────

/**
 * The five BookingKoala columns that carry add-on names.
 *
 * Read by HEADER NAME, never by position: `Extras` sits at index 53 in the
 * export while the other four are 65-68, so a positional assumption breaks the
 * moment BookingKoala reorders a column.
 */
export const BK_ADDON_COLUMNS = [
  "Extras",
  "Items",
  "Packages",
  "Package addons",
  "Addons",
] as const;

export type BkAddOnSource = (typeof BK_ADDON_COLUMNS)[number];

export interface BkAddOn {
  /** BookingKoala's own name — whitespace-normalised, quantity marker removed. */
  name: string;
  /** >= 1. Defaults to 1 when the cell carries no marker. */
  quantity: number;
  /** Which column it came from, so an import review can say where to look. */
  source: BkAddOnSource;
}

/**
 * Split ONE cell into add-on fragments.
 *
 * Splits on `;` and newlines, then on commas that are NOT inside parentheses —
 * done with a depth counter rather than a regex, because a regex cannot count
 * nesting and `"Deep Clean (2 rooms), Windows"` is two add-ons, not three.
 */
export function splitBkAddOnList(raw: string): string[] {
  const out: string[] = [];
  let buf = "";
  let depth = 0;
  const flush = () => {
    const v = buf.trim();
    // Drop empties and bare numbers ("0.00" shows up in blank money columns).
    if (v && !/^[\d.,\s$-]+$/.test(v)) out.push(v);
    buf = "";
  };
  for (const ch of raw) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ";" || ch === "\n" || ch === "\r" || (ch === "," && depth === 0)) {
      flush();
      continue;
    }
    buf += ch;
  }
  flush();
  return out;
}

/** Hard ceiling on a parsed quantity — a 4-digit run is a mis-parse, not an order. */
const BK_MAX_QUANTITY = 99;

/**
 * Pull a trailing quantity marker off one fragment.
 *
 * BookingKoala's own convention is a trailing `(N)` — the single populated
 * fixture value is `"2 Day Post Construction(1)"`. Two traps that shape this:
 *
 *   * the NAME can start with a digit, so the pattern is anchored at the END
 *     and never inspects the head of the string;
 *   * `(...)` also appears in descriptive text (`"Windows (interior)"`) and in
 *     Frequency values (`"Bi Weekly (2 Cleanings/Month -8%)"`), so the capture
 *     is digits-only — those cannot match at all, structurally rather than by
 *     luck.
 *
 * The `xN` form is tried only if `(N)` did not match, since it has never been
 * observed in real data and must never override the form that has.
 */
function parseBkQuantity(fragment: string): { name: string; quantity: number } {
  const paren = /^(.+?)\s*\((\d{1,3})\)$/.exec(fragment);
  if (paren) {
    return {
      name: paren[1].trim(),
      quantity: clampBkQuantity(parseInt(paren[2], 10)),
    };
  }
  const xForm = /^(.{2,}?)\s*[x×]\s*(\d{1,3})$/i.exec(fragment);
  if (xForm) {
    return {
      name: xForm[1].trim(),
      quantity: clampBkQuantity(parseInt(xForm[2], 10)),
    };
  }
  return { name: fragment.trim(), quantity: 1 };
}

function clampBkQuantity(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, BK_MAX_QUANTITY);
}

/**
 * Read all five add-on columns off one CSV row.
 *
 * Parses each column SEPARATELY rather than re-splitting the `"; "`-joined
 * notes string: that join is an output format, and splitting it back would
 * throw away the per-column provenance the import review needs.
 *
 * Duplicates across columns are merged by `addOnKey` — the canonical
 * name normaliser used by the checklist triggers — with quantities summed, so
 * "Inside Fridge" in Extras and "inside fridge(2)" in Addons is one row of 3.
 */
export function parseBkAddOns(get: (column: string) => string): BkAddOn[] {
  const merged = new Map<string, BkAddOn>();
  for (const column of BK_ADDON_COLUMNS) {
    const cell = clean(get(column));
    if (!cell) continue;
    for (const fragment of splitBkAddOnList(cell)) {
      const { name, quantity } = parseBkQuantity(fragment);
      const tidy = name.replace(/\s+/g, " ").trim();
      // An add-on name always contains a letter. This drops leftovers that
      // survive the marker rules but name nothing — a bare "(3)" (which the
      // `(N)` pattern deliberately refuses, since it has no name in front of
      // it), stray punctuation, and separator debris.
      if (!/\p{L}/u.test(tidy)) continue;
      const key = addOnKey(tidy);
      const existing = merged.get(key);
      if (existing) {
        existing.quantity = clampBkQuantity(existing.quantity + quantity);
      } else {
        merged.set(key, { name: tidy, quantity, source: column });
      }
    }
  }
  return [...merged.values()];
}

export interface ProviderInfo {
  email: string | null;
  name: string;
  bkId: string | null;
  phone: string | null;
  payment: number;
}

/** Parse the pseudo-JSON "Provider details" column (unquoted keys/values). */
export function parseProviderDetails(raw: string): ProviderInfo[] {
  if (!raw || !raw.trim()) return [];
  const out: ProviderInfo[] = [];
  const blocks = raw.split(/\}\s*,\s*\{/);
  for (const block of blocks) {
    const get = (key: string): string | null => {
      const m = block.match(new RegExp(`${key}\\s*:\\s*([^\\n}]+)`, "i"));
      if (!m) return null;
      return m[1].replace(/,\s*$/, "").trim() || null;
    };
    const name = get("Name");
    const email = get("Email Id");
    if (!name && !email) continue;
    out.push({
      email: email ? email.toLowerCase() : null,
      name: name ? fixMojibake(name) : email || "Cleaner",
      bkId: get("Id"),
      phone: get("Phone Number"),
      payment: money(get("Payment Amount") || "0"),
    });
  }
  return out;
}

// ── service → jobType + clientType mapping ───────────────────────────────────
export function mapService(
  serviceRaw: string,
  industryRaw: string
): { jobType: string; clientType: "RESIDENTIAL" | "COMMERCIAL" } {
  const s = serviceRaw.toLowerCase();
  let jobType: string;
  if (s.includes("move")) jobType = "MOVE_IN_OUT";
  else if (s.includes("commercial")) jobType = "COMMERCIAL";
  else if (s.includes("post construction") || s.includes("post-construction"))
    jobType = "POST_CONSTRUCTION";
  else if (s.includes("deep")) jobType = "DEEP";
  else jobType = "RESIDENTIAL"; // House / Apartment / N-Bedroom / Detached
  const clientType: "RESIDENTIAL" | "COMMERCIAL" =
    jobType === "COMMERCIAL" || industryRaw.toLowerCase().includes("commercial")
      ? "COMMERCIAL"
      : "RESIDENTIAL";
  return { jobType, clientType };
}

// ── normalized row ───────────────────────────────────────────────────────────
export interface NormalizedJob {
  /** BookingKoala's unique booking id — the dedup key (concurrent jobs at the
   *  same time for one client are distinct bookings, so we never dedup on time). */
  bookingId: string | null;
  clientName: string;
  location: string | null;
  aptNumber: string | null;
  jobType: string;
  /**
   * Apartment/condo vs house, read from the SAME raw "Service" string that
   * `jobType` above is derived from - but read BEFORE `mapService` collapses
   * "House" / "Apartment" / "Condo" / "Townhouse" / "Detached Home" onto the
   * single service category RESIDENTIAL (Stage 9 / PDF #11).
   *
   * That collapse is correct and unchanged: a house clean and an apartment
   * clean are the same SERVICE. What it lost was the PROPERTY fact, and this is
   * where that now survives. Null for a genuine service name ("Deep Cleaning",
   * "Move In & Out") and for anything unrecognised - the column is nullable and
   * an admin can set it by hand afterwards, which beats guessing.
   */
  propertyType: PropertyType | null;
  status: "CREATED" | "SCHEDULED" | "PAID";
  price: number;
  subtotalAmount: number;
  totalAmount: number;
  tipAmount: number;
  totalTip: number | null;
  parking: number | null;
  refundedAmount: number;
  discountAmount: number | null;
  appliedPromoCode: string | null;
  bedCount: number | null;
  bathCount: number | null;
  halfBathCount: number | null;
  squareFootage: number | null;
  paymentType: "CREDIT_CARD" | "CASH";
  isCashJob: boolean;
  paymentReceived: boolean;
  employeePay: number | null;
  requiredCleaners: number;
  /** Customer-/cleaner-facing note (add-ons only); null when none. */
  notes: string | null;
  /**
   * Structured add-ons parsed from the five CSV columns (item 9).
   *
   * NOTE ON MONEY: these carry names and quantities, never prices. The CSV's
   * "Service total" already includes the extras, so pricing these rows would
   * bill an imported job for them a second time. See runBookingKoalaImport.
   */
  addOns: BkAddOn[];
  /** Internal traceability (source + team payout) → admin-only job log. */
  importNote: string;
  /** Stripe PaymentIntent id from the CSV "Transaction id" column. */
  transactionId: string | null;
  startTime: Date;
  endTime: Date | null;
}

export interface NormalizedRow {
  rowNum: number;
  customerKey: string;
  customer: {
    name: string;
    email: string | null;
    phone: string | null;
    company: string | null;
    clientType: "RESIDENTIAL" | "COMMERCIAL";
  };
  address: {
    address: string;
    apt: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  } | null;
  job: NormalizedJob;
  providers: ProviderInfo[];
}

// A row that could NOT be imported (surfaced to the user instead of silently
// dropped) — currently only rows with a missing/unreadable start date/time,
// since a job cannot exist without one. The user fixes these in the CSV and
// re-imports.
export interface ImportProblemRow {
  rowNum: number; // spreadsheet row number (header = row 1)
  reason: string;
  customer: string;
  bookingId: string | null;
}

export interface ParseResult {
  header: string[];
  rows: NormalizedRow[];
  parsedCount: number;
  droppedCount: number;
  problemRows: ImportProblemRow[];
  mojibakeCount: number;
}

/** Customer dedup key: email if present, else name+phone (cash, no-email). */
function customerKeyFrom(email: string, name: string, phone: string): string {
  if (email) return `email:${email.toLowerCase()}`;
  return `np:${name.toLowerCase()}|${phone.replace(/\D/g, "")}`;
}

/** Parse a BookingKoala CSV export → date-filtered, normalized rows. */
export function parseAndNormalize(csvText: string): ParseResult {
  const rows = parseCSV(csvText);
  const header = (rows[0] ?? []).map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const dataRows = rows.slice(1).filter((r) => r.length > 1);

  let mojibakeCount = 0;
  const out: NormalizedRow[] = [];
  const problemRows: ImportProblemRow[] = [];

  dataRows.forEach((r, i) => {
    const get = (name: string) => r[idx(name)] ?? "";
    if (/[ÃÂâ€]/.test(get("City") + get("Address") + get("State"))) mojibakeCount++;

    // No date-window filter — bookings from ANY date import. The only rows that
    // can't import are ones with a missing/unreadable start date/time (a job
    // needs a real start time). Those are recorded as problem rows, not dropped.
    const startRaw = clean(get("Booking start date time"));
    const start = new Date(startRaw);
    if (!startRaw || isNaN(start.getTime())) {
      problemRows.push({
        rowNum: i + 2,
        reason: startRaw
          ? `Unreadable "Booking start date time": ${startRaw}`
          : `Missing "Booking start date time"`,
        customer: clean(get("Full name")) || clean(get("Email")) || "(unknown)",
        bookingId: clean(get("Booking id")) || null,
      });
      return;
    }
    const endRaw = clean(get("Booking end date time"));
    const endParsed = endRaw ? new Date(endRaw) : null;
    const end =
      endParsed && !isNaN(endParsed.getTime()) && endParsed > start ? endParsed : null;

    const { jobType, clientType } = mapService(
      clean(get("Service")),
      clean(get("Industry"))
    );

    const serviceTotal = money(get("Service total (CAD)"));
    const finalAmount = money(get("Final amount (CAD)"));
    const amountPaid = money(get("Amount paid by customer (CAD)"));
    const tip = money(get("Tip (CAD)"));
    const parking = money(get("Parking (CAD)"));
    const refunded = money(get("Refunded amount (CAD)"));
    const discountAmount =
      money(get("Discount amount (CAD)")) + money(get("Discount from code (CAD)"));
    const paymentMethod = clean(get("Payment method"));
    const paymentType = paymentMethod === "CC" ? "CREDIT_CARD" : "CASH";
    const paid = amountPaid > 0;
    const status =
      serviceTotal <= 0 && finalAmount <= 0 ? "CREATED" : paid ? "PAID" : "SCHEDULED";

    const providers = parseProviderDetails(get("Provider details"));
    const teamPayout = money(get("Provider/team payment (CAD)"));

    const addonText = [
      clean(get("Extras")),
      clean(get("Addons")),
      clean(get("Packages")),
      clean(get("Package addons")),
      clean(get("Items")),
    ]
      .filter(Boolean)
      .join("; ");
    // Customer-/cleaner-facing note: ONLY the add-ons they booked (or nothing).
    // Deliberately KEPT verbatim alongside the structured rows below — it is the
    // only record of the pre-parse BookingKoala text, so a mis-parse stays
    // diagnosable and the notes cleanup (item 15) has something to preserve.
    const customerNote = addonText ? `Add-ons: ${addonText}` : null;
    // Structured add-ons (item 9) — parsed from the same five columns, per
    // column, with quantities. These become real JobAddOn rows.
    const addOns = parseBkAddOns(get);
    // Internal traceability (source + team payout) — never shown to the customer
    // or cleaner; persisted as an admin-only NOTE_ADDED job log instead. The
    // parsed interpretation goes here too, so an admin can see how the raw text
    // was read without the customer-facing note growing.
    const importNote =
      `Imported from BookingKoala (booking ${clean(get("Booking id")) || "?"}, ${
        clean(get("Frequency")) || "?"
      }).` +
      (providers.length
        ? ` Team: ${providers.map((p) => `${p.name} ($${p.payment.toFixed(0)})`).join(", ")}.`
        : "") +
      (addOns.length
        ? ` Add-ons parsed: ${addOns
            .map((a) => (a.quantity > 1 ? `${a.name} ×${a.quantity}` : a.name))
            .join(", ")}.`
        : "");

    const email = cleanOrNull(get("Email"))?.toLowerCase() ?? null;
    const name = clean(get("Full name")) || email || "Customer";
    const phone = cleanOrNull(get("Phone"));
    const address = clean(get("Address"));

    out.push({
      rowNum: i + 2,
      customerKey: customerKeyFrom(email ?? "", name, phone ?? ""),
      customer: {
        name,
        email,
        phone,
        company: cleanOrNull(get("Company name")),
        clientType,
      },
      address: address
        ? {
            address,
            apt: cleanOrNull(get("Apt")),
            city: cleanOrNull(get("City")),
            state: cleanOrNull(get("State")),
            zip: cleanZip(get("Zip/Postal code")),
          }
        : null,
      job: {
        bookingId: clean(get("Booking id")) || null,
        transactionId: cleanOrNull(get("Transaction id")),
        clientName: name,
        location: address || null,
        aptNumber: cleanOrNull(get("Apt")),
        jobType,
        // Captured from the raw column, deliberately NOT from `jobType` - by
        // the time `mapService` has run, "Condo" and "Deep Cleaning" are both
        // just RESIDENTIAL/DEEP and the property word is gone (step 9.6).
        propertyType: inferPropertyTypeFromText(clean(get("Service"))),
        status,
        price: serviceTotal,
        subtotalAmount: serviceTotal,
        totalAmount: finalAmount || serviceTotal,
        tipAmount: tip,
        totalTip: tip || null,
        parking: parking || null,
        refundedAmount: refunded,
        discountAmount: discountAmount > 0 ? discountAmount : null,
        appliedPromoCode: cleanOrNull(get("Discount code")),
        bedCount: intOrNull(get("Bedrooms")),
        bathCount: intOrNull(get("Full Bathrooms")),
        halfBathCount: intOrNull(get("Half Bathrooms")),
        squareFootage: intOrNull(get("Sq Ft")),
        paymentType,
        isCashJob: paymentType === "CASH",
        paymentReceived: paid,
        employeePay: teamPayout || null,
        requiredCleaners: Math.max(1, providers.length),
        notes: customerNote,
        addOns,
        importNote,
        startTime: start,
        endTime: end,
      },
      providers,
    });
  });

  return {
    header,
    rows: out,
    parsedCount: dataRows.length,
    droppedCount: problemRows.length,
    problemRows,
    mojibakeCount,
  };
}

// ── customer aggregation (collect addresses, most-recent = default) ──────────
export interface CustomerAggregate {
  key: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  clientType: "RESIDENTIAL" | "COMMERCIAL";
  addresses: {
    address: string;
    apt: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    /**
     * The property size the MOST RECENT booking at this door recorded (new
     * photo/address fixes, item 3). BookingKoala files bedrooms / bathrooms /
     * sq ft per booking, and the importer already copies them onto each job;
     * this is the same numbers travelling one step further, onto the saved
     * address, so the first Cleano booking at an imported address arrives
     * pre-filled instead of asking the admin to retype what the CSV said.
     *
     * Most-recent wins for the same reason the rest of this aggregate is
     * most-recent-wins: a customer who finished their basement in 2024 should
     * not be described by their 2021 booking. All nullable — plenty of CSV rows
     * leave these columns empty, and `upsertClientAddress` writes blanks only,
     * so an empty one can never erase a value already on the row.
     */
    propertyType: PropertyType | null;
    bedCount: number | null;
    bathCount: number | null;
    halfBathCount: number | null;
    squareFootage: number | null;
    lastSeen: number;
  }[];
}

export function aggregateCustomers(rows: NormalizedRow[]): CustomerAggregate[] {
  const map = new Map<string, CustomerAggregate & { latest: number; addrMap: Map<string, CustomerAggregate["addresses"][number]> }>();
  for (const r of rows) {
    const ts = r.job.startTime.getTime();
    let agg = map.get(r.customerKey);
    if (!agg) {
      agg = {
        key: r.customerKey,
        name: r.customer.name,
        email: r.customer.email,
        phone: r.customer.phone,
        company: r.customer.company,
        clientType: r.customer.clientType,
        addresses: [],
        latest: 0,
        addrMap: new Map(),
      };
      map.set(r.customerKey, agg);
    }
    if (ts >= agg.latest) {
      agg.latest = ts;
      agg.name = r.customer.name || agg.name;
      agg.phone = r.customer.phone ?? agg.phone;
      agg.company = r.customer.company ?? agg.company;
      if (r.customer.clientType === "COMMERCIAL") agg.clientType = "COMMERCIAL";
    }
    if (r.address) {
      const norm = r.address.address.toLowerCase().replace(/\s+/g, " ");
      const prev = agg.addrMap.get(norm);
      if (!prev || ts > prev.lastSeen) {
        agg.addrMap.set(norm, {
          ...r.address,
          // The size comes off the same row as the address, so the two always
          // describe the same booking (item 3).
          propertyType: r.job.propertyType,
          bedCount: r.job.bedCount,
          bathCount: r.job.bathCount,
          halfBathCount: r.job.halfBathCount,
          squareFootage: r.job.squareFootage,
          lastSeen: ts,
        });
      }
    }
  }
  return [...map.values()].map((a) => ({
    key: a.key,
    name: a.name,
    email: a.email,
    phone: a.phone,
    company: a.company,
    clientType: a.clientType,
    addresses: [...a.addrMap.values()].sort((x, y) => y.lastSeen - x.lastSeen),
  }));
}

/** Unique cleaners across all rows, keyed by email (or name when no email). */
export function collectCleaners(rows: NormalizedRow[]): ProviderInfo[] {
  const byKey = new Map<string, ProviderInfo>();
  for (const r of rows) {
    for (const p of r.providers) {
      const key = p.email || `name:${p.name.toLowerCase()}`;
      if (!byKey.has(key)) byKey.set(key, p);
    }
  }
  return [...byKey.values()];
}

export function cleanerKey(p: ProviderInfo): string {
  return p.email || `name:${p.name.toLowerCase()}`;
}

// ── report shape (shared with the UI; import as a type only on the client) ───
export interface ImportReport {
  ok: boolean;
  error?: string;
  dryRun: boolean;
  parsedCount: number;
  droppedCount: number;
  problemRows: ImportProblemRow[];
  mojibakeCount: number;
  /** Total importable rows in the file — used to drive batched commits from the UI. */
  totalRows?: number;
  cleaners: { created: number; existing: number; skipped: number; failed: number };
  customers: { created: number; existing: number; failed: number };
  addresses: number;
  /**
   * `skipped` is the TOTAL skipped, broken down by cause so the summary can say
   * WHY a row didn't import:
   *   duplicates — same booking already imported (BookingKoala booking id, or
   *                client+exact start time when the row has no booking id)
   *   sameDay    — only when the opt-in "skip same-client same-day" guard is on
   */
  jobs: {
    created: number;
    skipped: number;
    failed: number;
    duplicates: number;
    sameDay: number;
  };
  statusCounts: Record<string, number>;
  /**
   * Structured add-ons created from the CSV (item 9). `unmatched` counts rows
   * whose BookingKoala name has no Cleano catalog entry — those are still
   * created (nothing is lost) but need an admin to price them.
   */
  addOns: { created: number; matched: number; unmatched: number };
  /** The unmatched names, for the "needs review" panel in the import summary. */
  addOnsNeedingReview: {
    name: string;
    quantity: number;
    source: string;
    rowNum: number;
    bookingId: string | null;
  }[];
  emails: { sent: number; failed: number };
  sample: {
    row: number;
    client: string;
    jobType: string;
    /**
     * How the CSV's "Service" word classified as a PROPERTY (Stage 9), beside
     * how it classified as a SERVICE. Both are in the dry-run table so the
     * admin can see the split is right before committing - the one place the
     * heuristic in `inferPropertyTypeFromText` is reviewable.
     */
    propertyType: string | null;
    start: string;
    price: number;
    status: string;
    cleaners: number;
  }[];
  failures: string[];
}
