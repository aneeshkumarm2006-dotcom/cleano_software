/**
 * DEPRECATED — do not run. Use the admin UI: Jobs → "Import from BookingKoala".
 *
 * This was the one-time CLI importer. It is kept only as a record of the
 * original import; every supported path now goes through
 * `src/app/admin/actions/runBookingKoalaImport.ts`, which uses the shared pure
 * core in `src/lib/bookingkoala/core.ts`.
 *
 * ## Why it is not simply "updated to use core.ts"
 *
 * The drift is in the WRITE half, not the parse half. Pointing its parsing at
 * `core.ts` would fix the harmless part and leave all of this live — producing
 * something that LOOKS consolidated and still writes wrong money to production:
 *
 *   1. Hard-coded 2026-06-01 → 2026-09-01 date window; every booking outside
 *      those three months is silently dropped. (The docstring said Jun 1 → Aug 1;
 *      even that disagreed with the code.)
 *   2. `gstAmount: 0, qstAmount: 0` — no tax is ever computed or stored, so
 *      every imported job's tax columns are wrong.
 *   3. `totalAmount` taken raw from the CSV, without the server action's
 *      "does the CSV total already include tax?" check.
 *   4. Its dedupe omits `deletedAt: null`, so an ARCHIVED job blocks re-import
 *      of that booking forever.
 *   5. Cleaner accounts are created without `mustChangePassword`.
 *   6. The Stripe PaymentIntent ("Transaction id") is never stored, so those
 *      jobs cannot be refunded from the job detail page.
 *   7. Its own copy of the Resend email code, with no ActivityLog audit rows.
 *   8. No structured add-ons (awerfixes item 9) — it writes none.
 *
 * Real consolidation means extracting a third module out of a server action
 * that depends on `auth`, `headers()` and `revalidatePath`, none of which exist
 * under `tsx`. That is its own piece of work, not a footnote to this one.
 *
 * Deleting it is deliberately NOT done here: destructive changes go last.
 * Instead `main()` refuses to run without an explicit acknowledgement flag, and
 * refuses `--commit` outright.
 */

import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";

// ── env bootstrap (tsx does not auto-load .env) ─────────────────────────────
function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    const p = path.resolve(process.cwd(), file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      )
        val = val.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
}
loadEnv();

// Imported AFTER env is loaded so PrismaClient sees DATABASE_URL.
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";

const db = new PrismaClient();

// ── flags ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const COMMIT = argv.includes("--commit");
const NO_EMAILS = argv.includes("--no-emails");
const SEND_EMAILS = COMMIT && !NO_EMAILS;
// Per-audience email control (so we can email cleaners but not customers, etc.)
const NO_CUSTOMER_EMAILS = argv.includes("--no-customer-emails");
const NO_CLEANER_EMAILS = argv.includes("--no-cleaner-emails");
const SEND_CLEANER_EMAILS = SEND_EMAILS && !NO_CLEANER_EMAILS;
const SEND_CUSTOMER_EMAILS = SEND_EMAILS && !NO_CUSTOMER_EMAILS;
// Debug aid for the controlled dummy test — prints generated temp passwords to
// stdout so we can verify login even if the email is delayed. Never use on the
// real import (don't log credentials for 136 real customers).
const PRINT_CREDS = argv.includes("--print-creds");
const fileArg = argv.find((a) => a.startsWith("--file="))?.slice("--file=".length);
const CSV_PATH =
  fileArg ||
  path.join(
    process.env.HOME || "",
    "Downloads",
    "1781752157_bookings_2026-06-01-to-2026-11-01.csv"
  );

// Inclusive start, exclusive end — Jun 1 → Sep 1 2026 (includes August).
const RANGE_START = new Date("2026-06-01T00:00:00-04:00");
const RANGE_END = new Date("2026-09-01T00:00:00-04:00");

const BOOKING_SOURCE = "bookingkoala_import";

// ── CSV parser (RFC-4180, handles quoted fields with embedded newlines) ──────
function parseCSV(text: string): string[][] {
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
function fixMojibake(s: string): string {
  if (!s || !/[ÃÂâ€]/.test(s)) return s;
  try {
    // Re-interpret the bytes as UTF-8.
    const fixed = Buffer.from(s, "latin1").toString("utf8");
    // Only accept if it didn't introduce replacement chars.
    return fixed.includes("�") ? s : fixed;
  } catch {
    return s;
  }
}

/** Strip Excel ="…" escaping and surrounding quotes. */
function unescapeExcel(s: string): string {
  let v = (s ?? "").trim();
  if (v.startsWith("=")) v = v.slice(1);
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  return v.trim();
}

/** Normalize a Canadian postal code → "H3P 2E3". */
function cleanZip(raw: string): string | null {
  let z = unescapeExcel(raw).replace(/\s+/g, "").toUpperCase();
  if (!z) return null;
  if (z.length === 6) z = z.slice(0, 3) + " " + z.slice(3);
  return z;
}

function money(raw: string | undefined): number {
  const n = parseFloat(String(raw ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function intOrNull(raw: string | undefined): number | null {
  const n = parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}
function clean(s: string | undefined): string {
  return fixMojibake((s ?? "").trim());
}
function cleanOrNull(s: string | undefined): string | null {
  const v = clean(s);
  return v === "" ? null : v;
}

/** 12-char readable temp password (no ambiguous chars). */
function makeTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

interface ProviderInfo {
  email: string | null;
  name: string;
  bkId: string | null;
  phone: string | null;
  payment: number;
}

/** Parse the pseudo-JSON "Provider details" column (unquoted keys/values). */
function parseProviderDetails(raw: string): ProviderInfo[] {
  if (!raw || !raw.trim()) return [];
  const out: ProviderInfo[] = [];
  // Split on object boundaries "}, {" — each block is one provider.
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
function mapService(serviceRaw: string, industryRaw: string): {
  jobType: string;
  clientType: "RESIDENTIAL" | "COMMERCIAL";
} {
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

// ── report accumulators ──────────────────────────────────────────────────────
type Tally = { created: number; existing: number; failed: number; skipped: number };
const log: string[] = [];
function note(s: string) {
  log.push(s);
  console.log(s);
}

async function main() {
  // Deprecation guard. This script writes wrong tax, drops bookings outside a
  // hard-coded 2026 window, and creates no add-on rows — see the file header.
  // It stays in the tree as a record of the original import, but it must not be
  // possible to run it against the live database by habit or by accident.
  if (COMMIT) {
    console.error(
      "\n✗ DEPRECATED: this script can no longer write to the database.\n" +
        "  It writes gstAmount/qstAmount as 0, drops any booking outside a\n" +
        "  hard-coded 2026-06-01..2026-09-01 window, ignores archived jobs in its\n" +
        "  dedupe, and creates no add-on rows.\n\n" +
        "  Use the admin UI instead: Jobs → Import from BookingKoala.\n"
    );
    process.exit(1);
  }
  if (!argv.includes("--i-know-this-is-deprecated")) {
    console.error(
      "\n✗ DEPRECATED: use the admin UI (Jobs → Import from BookingKoala).\n" +
        "  To run this read-only anyway, pass --i-know-this-is-deprecated.\n"
    );
    process.exit(1);
  }

  note(`\n${"=".repeat(70)}`);
  note(`BookingKoala import — ${COMMIT ? "COMMIT (writes DB)" : "DRY RUN (no writes)"}`);
  note(`emails: ${SEND_EMAILS ? "ON (account/login only)" : "OFF"}`);
  note(`file:   ${CSV_PATH}`);
  note("=".repeat(70));

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`\n✗ CSV not found at ${CSV_PATH}. Pass --file=/abs/path.csv`);
    process.exit(1);
  }

  const rawText = fs.readFileSync(CSV_PATH, "utf8");
  const rows = parseCSV(rawText);
  const header = rows[0].map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const col = (r: string[], name: string) => r[idx(name)] ?? "";
  const dataRows = rows.slice(1).filter((r) => r.length > 1);

  note(`\nParsed ${dataRows.length} data rows, ${header.length} columns.`);

  // Mojibake audit
  let mojibakeCount = 0;
  for (const r of dataRows) {
    if (/[ÃÂâ€]/.test(col(r, "City") + col(r, "Address") + col(r, "State")))
      mojibakeCount++;
  }
  note(`Encoding: ${mojibakeCount} rows had mojibake (fixed in place).`);

  // ── date filter ──
  type Parsed = {
    rowNum: number;
    r: string[];
    start: Date;
    end: Date | null;
  };
  const inRange: Parsed[] = [];
  let droppedDate = 0;
  dataRows.forEach((r, i) => {
    const startStr = clean(col(r, "Booking start date time"));
    const start = new Date(startStr);
    if (isNaN(start.getTime())) {
      droppedDate++;
      return;
    }
    if (start < RANGE_START || start >= RANGE_END) {
      droppedDate++;
      return;
    }
    const endStr = clean(col(r, "Booking end date time"));
    const end = endStr ? new Date(endStr) : null;
    inRange.push({
      rowNum: i + 2,
      r,
      start,
      end: end && !isNaN(end.getTime()) && end > start ? end : null,
    });
  });
  note(
    `Date filter [Jun 1 → Sep 1): kept ${inRange.length}, dropped ${droppedDate} out-of-range.`
  );

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1: cleaners (from Provider details across all in-range rows)
  // ─────────────────────────────────────────────────────────────────────────
  const cleanerByEmail = new Map<string, ProviderInfo>();
  const cleanerByName = new Map<string, ProviderInfo>();
  for (const { r } of inRange) {
    for (const p of parseProviderDetails(col(r, "Provider details"))) {
      const key = p.email || `name:${p.name.toLowerCase()}`;
      if (p.email && !cleanerByEmail.has(p.email)) cleanerByEmail.set(p.email, p);
      if (!p.email && !cleanerByName.has(key)) cleanerByName.set(key, p);
    }
  }
  const allCleaners = [...cleanerByEmail.values(), ...cleanerByName.values()];
  note(`\n${"─".repeat(70)}\nCLEANERS: ${allCleaners.length} unique in file.`);

  const cleanerTally: Tally = { created: 0, existing: 0, failed: 0, skipped: 0 };
  // email/name → resolved User id (filled on commit; left null on dry-run).
  const cleanerUserId = new Map<string, string | null>();
  const cleanerCreds: { name: string; email: string; tempPassword: string }[] = [];

  for (const p of allCleaners) {
    const lookupKey = p.email || `name:${p.name.toLowerCase()}`;
    if (!p.email) {
      // No email → cannot create a login account; flag for manual handling.
      cleanerTally.skipped++;
      note(`  ⚠ skip cleaner "${p.name}" — no email in file (needs manual setup)`);
      cleanerUserId.set(lookupKey, null);
      continue;
    }
    try {
      const existing = await db.user.findUnique({ where: { email: p.email } });
      if (existing) {
        cleanerTally.existing++;
        cleanerUserId.set(lookupKey, existing.id);
        note(`  • exists  ${p.name} <${p.email}> (${existing.role})`);
        continue;
      }
      if (!COMMIT) {
        cleanerTally.created++;
        cleanerUserId.set(lookupKey, null);
        note(`  + create  ${p.name} <${p.email}>  [dry-run]`);
        continue;
      }
      const tempPassword = makeTempPassword();
      const hashed = await hashPassword(tempPassword);
      const user = await db.user.create({
        data: {
          name: p.name,
          email: p.email,
          phone: p.phone,
          emailVerified: true,
          isActive: true,
          role: "EMPLOYEE",
        },
      });
      await db.account.create({
        data: {
          userId: user.id,
          accountId: user.id,
          providerId: "credential",
          password: hashed,
        },
      });
      cleanerUserId.set(lookupKey, user.id);
      cleanerCreds.push({ name: p.name, email: p.email, tempPassword });
      cleanerTally.created++;
      note(`  + created ${p.name} <${p.email}>`);
      if (SEND_CLEANER_EMAILS) await emailCleanerWelcome(p.name, p.email, tempPassword);
    } catch (e) {
      cleanerTally.failed++;
      note(`  ✗ FAILED cleaner ${p.name} <${p.email}>: ${(e as Error).message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2: customers — group rows by client key, collect addresses
  // ─────────────────────────────────────────────────────────────────────────
  type ClientAgg = {
    key: string;
    name: string;
    email: string | null;
    phone: string | null;
    company: string | null;
    clientType: "RESIDENTIAL" | "COMMERCIAL";
    // address (normalized) → { display, apt, city, state, zip, lastSeen }
    addresses: Map<
      string,
      {
        address: string;
        apt: string | null;
        city: string | null;
        state: string | null;
        zip: string | null;
        lastSeen: number;
      }
    >;
    latest: number;
  };
  const clientAgg = new Map<string, ClientAgg>();

  function clientKey(r: string[]): string {
    const email = clean(col(r, "Email")).toLowerCase();
    if (email) return `email:${email}`;
    const name = clean(col(r, "Full name")).toLowerCase();
    const phone = clean(col(r, "Phone")).replace(/\D/g, "");
    return `np:${name}|${phone}`;
  }

  for (const { r, start } of inRange) {
    const key = clientKey(r);
    const email = cleanOrNull(col(r, "Email"))?.toLowerCase() ?? null;
    const { clientType } = mapService(clean(col(r, "Service")), clean(col(r, "Industry")));
    const addr = clean(col(r, "Address"));
    const ts = start.getTime();
    let agg = clientAgg.get(key);
    if (!agg) {
      agg = {
        key,
        name: clean(col(r, "Full name")) || email || "Customer",
        email,
        phone: cleanOrNull(col(r, "Phone")),
        company: cleanOrNull(col(r, "Company name")),
        clientType,
        addresses: new Map(),
        latest: 0,
      };
      clientAgg.set(key, agg);
    }
    // Prefer the most-recent booking's name / phone / company / type.
    if (ts >= agg.latest) {
      agg.latest = ts;
      agg.name = clean(col(r, "Full name")) || agg.name;
      agg.phone = cleanOrNull(col(r, "Phone")) ?? agg.phone;
      agg.company = cleanOrNull(col(r, "Company name")) ?? agg.company;
      if (clientType === "COMMERCIAL") agg.clientType = "COMMERCIAL";
    }
    if (addr) {
      const norm = addr.toLowerCase().replace(/\s+/g, " ");
      const prev = agg.addresses.get(norm);
      if (!prev || ts > prev.lastSeen) {
        agg.addresses.set(norm, {
          address: addr,
          apt: cleanOrNull(col(r, "Apt")),
          city: cleanOrNull(col(r, "City")),
          state: cleanOrNull(col(r, "State")),
          zip: cleanZip(col(r, "Zip/Postal code")),
          lastSeen: ts,
        });
      }
    }
  }

  const distinctAddresses = [...clientAgg.values()].reduce(
    (sum, a) => sum + a.addresses.size,
    0
  );
  note(
    `\n${"─".repeat(70)}\nCUSTOMERS: ${clientAgg.size} unique (by email, or name+phone for no-email); ${distinctAddresses} distinct addresses in file.`
  );
  const custTally: Tally = { created: 0, existing: 0, failed: 0, skipped: 0 };
  const clientIdByKey = new Map<string, string | null>();
  const custCreds: { name: string; email: string; tempPassword: string }[] = [];
  let addressesCreated = 0;

  for (const agg of clientAgg.values()) {
    try {
      // Most-recent address = default.
      const addrList = [...agg.addresses.values()].sort(
        (a, b) => b.lastSeen - a.lastSeen
      );
      const primary = addrList[0] ?? null;

      const existing = agg.email
        ? await db.client.findFirst({ where: { email: agg.email } })
        : await db.client.findFirst({
            where: { name: agg.name, phone: agg.phone ?? undefined },
          });

      if (!COMMIT) {
        clientIdByKey.set(agg.key, existing?.id ?? null);
        if (existing) {
          custTally.existing++;
          note(
            `  • exists  ${agg.name} <${agg.email ?? "no-email"}> (+${addrList.length} addr)`
          );
        } else {
          custTally.created++;
          note(
            `  + create  ${agg.name} <${agg.email ?? "no-email"}> (${addrList.length} addr, ${agg.clientType})  [dry-run]`
          );
        }
        continue;
      }

      let clientId: string;
      if (existing) {
        custTally.existing++;
        clientId = existing.id;
        // Fill blanks only — never overwrite admin-set values.
        await db.client.update({
          where: { id: existing.id },
          data: {
            ...(existing.phone ? {} : agg.phone ? { phone: agg.phone } : {}),
            ...(existing.company ? {} : agg.company ? { company: agg.company } : {}),
            ...(existing.address || !primary ? {} : { address: primary.address }),
            ...(existing.city || !primary?.city ? {} : { city: primary.city }),
            ...(existing.state || !primary?.state ? {} : { state: primary.state }),
            ...(existing.zip || !primary?.zip ? {} : { zip: primary.zip }),
          },
        });
      } else {
        const created = await db.client.create({
          data: {
            name: agg.name,
            email: agg.email,
            phone: agg.phone,
            company: agg.company,
            clientType: agg.clientType,
            isActive: true,
            address: primary?.address ?? null,
            aptNumber: primary?.apt ?? null,
            city: primary?.city ?? null,
            state: primary?.state ?? null,
            zip: primary?.zip ?? null,
          },
        });
        clientId = created.id;
        custTally.created++;
      }

      // Addresses (idempotent: skip ones already stored for this client).
      const existingAddrs = await db.clientAddress.findMany({
        where: { clientId },
        select: { address: true },
      });
      const have = new Set(
        existingAddrs.map((a) => a.address.toLowerCase().replace(/\s+/g, " "))
      );
      for (let i = 0; i < addrList.length; i++) {
        const a = addrList[i];
        const norm = a.address.toLowerCase().replace(/\s+/g, " ");
        if (have.has(norm)) continue;
        await db.clientAddress.create({
          data: {
            clientId,
            label: i === 0 ? "Home" : `Address ${i + 1}`,
            address: a.apt ? `${a.apt} – ${a.address}` : a.address,
            aptNumber: a.apt,
            isDefault: i === 0, // most-recent
          },
        });
        addressesCreated++;
      }

      // Customer login: create User(CLIENT) + credential account + temp password.
      if (agg.email) {
        const linkedUser = await ensureCustomerLogin(agg.name, agg.email, clientId);
        if (linkedUser?.tempPassword) {
          custCreds.push({
            name: agg.name,
            email: agg.email,
            tempPassword: linkedUser.tempPassword,
          });
          if (SEND_CUSTOMER_EMAILS)
            await emailCustomerWelcome(agg.name, agg.email, linkedUser.tempPassword);
        }
      } else {
        note(`  ⚠ ${agg.name} has no email — no portal login created (cash client).`);
      }

      clientIdByKey.set(agg.key, clientId);
    } catch (e) {
      custTally.failed++;
      clientIdByKey.set(agg.key, null);
      note(`  ✗ FAILED customer ${agg.name}: ${(e as Error).message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 3: jobs — one per row
  // ─────────────────────────────────────────────────────────────────────────
  note(`\n${"─".repeat(70)}\nJOBS: ${inRange.length} candidate rows.`);
  const jobTally: Tally = { created: 0, existing: 0, failed: 0, skipped: 0 };
  const seen = new Set<string>(); // within-run dedup (clientKey + startISO)
  const statusCounts: Record<string, number> = {};

  for (const { r, rowNum, start, end } of inRange) {
    try {
      const key = clientKey(r);
      const clientId = clientIdByKey.get(key) ?? null;
      // Dedup on the BookingKoala Booking id — the only true unique key. Keying
      // on customer+start-time would wrongly drop legitimate concurrent bookings
      // (e.g. a property manager with two cleanings at the same hour).
      const bkBookingId = clean(col(r, "Booking id"));
      const dedupKey = bkBookingId
        ? `bk:${bkBookingId}`
        : `${key}|${start.toISOString()}`;
      if (seen.has(dedupKey)) {
        jobTally.skipped++;
        note(`  ↷ row ${rowNum}: dedup (duplicate booking id ${bkBookingId || "—"})`);
        continue;
      }
      seen.add(dedupKey);

      const serviceTotal = money(col(r, "Service total (CAD)"));
      const finalAmount = money(col(r, "Final amount (CAD)"));
      const amountPaid = money(col(r, "Amount paid by customer (CAD)"));
      const tip = money(col(r, "Tip (CAD)"));
      const parking = money(col(r, "Parking (CAD)"));
      const refunded = money(col(r, "Refunded amount (CAD)"));
      const discountAmount =
        money(col(r, "Discount amount (CAD)")) + money(col(r, "Discount from code (CAD)"));
      const discountCode = cleanOrNull(col(r, "Discount code"));
      const { jobType } = mapService(clean(col(r, "Service")), clean(col(r, "Industry")));

      const paymentMethod = clean(col(r, "Payment method"));
      const paymentType = paymentMethod === "CC" ? "CREDIT_CARD" : "CASH"; // Cash/Check → Cash
      const isCashJob = paymentType === "CASH";

      const paid = amountPaid > 0;
      // $0 service total → on hold (CREATED) for review; paid → PAID; else SCHEDULED.
      const status =
        serviceTotal <= 0 && finalAmount <= 0
          ? "CREATED"
          : paid
          ? "PAID"
          : "SCHEDULED";
      statusCounts[status] = (statusCounts[status] || 0) + 1;

      // Cleaners on this row.
      const providers = parseProviderDetails(col(r, "Provider details"));
      const cleanerIds: string[] = [];
      for (const p of providers) {
        const lk = p.email || `name:${p.name.toLowerCase()}`;
        const id = cleanerUserId.get(lk);
        if (id) cleanerIds.push(id);
      }
      const teamPayout = money(col(r, "Provider/team payment (CAD)"));

      // Notes: extras / add-ons / packages + traceability.
      const extras = clean(col(r, "Extras"));
      const addons = clean(col(r, "Addons"));
      const packages = clean(col(r, "Packages"));
      const pkgAddons = clean(col(r, "Package addons"));
      const items = clean(col(r, "Items"));
      const addonText = [extras, addons, packages, pkgAddons, items]
        .filter(Boolean)
        .join("; ");
      const freq = clean(col(r, "Frequency"));
      // Customer-/cleaner-facing note: only the add-ons (or none).
      const customerNote = addonText ? `Add-ons: ${addonText}` : null;
      // Internal traceability → admin-only NOTE_ADDED log (never shown to the
      // customer or cleaner).
      const importNote =
        `Imported from BookingKoala (booking ${bkBookingId || "?"}, ${freq || "?"}).` +
        (providers.length
          ? ` Team: ${providers.map((p) => `${p.name} ($${p.payment.toFixed(0)})`).join(", ")}.`
          : "");

      const address = clean(col(r, "Address"));
      const apt = cleanOrNull(col(r, "Apt"));
      const clientName = clean(col(r, "Full name")) || "Customer";

      const data: any = {
        clientName,
        ...(clientId ? { client: { connect: { id: clientId } } } : {}),
        location: address || null,
        aptNumber: apt,
        description: `${jobType} cleaning`,
        jobType,
        jobDate: start,
        startTime: start,
        endTime: end,
        status,
        price: serviceTotal,
        subtotalAmount: serviceTotal,
        totalAmount: finalAmount || serviceTotal,
        gstAmount: 0, // CSV only has a combined "Sales Tax"; left unsplit.
        qstAmount: 0,
        tipAmount: tip,
        totalTip: tip || null,
        parking: parking || null,
        discountAmount: discountAmount > 0 ? discountAmount : null,
        appliedPromoCode: discountCode,
        bedCount: intOrNull(col(r, "Bedrooms")),
        bathCount: intOrNull(col(r, "Full Bathrooms")),
        halfBathCount: intOrNull(col(r, "Half Bathrooms")),
        squareFootage: intOrNull(col(r, "Sq Ft")),
        paymentType,
        isCashJob,
        paymentReceived: paid,
        paidAt: paid ? start : null,
        refundedAmount: refunded,
        employeePay: teamPayout || null,
        // D2 — the CSV's provider/team payment is what BookingKoala actually
        // paid this crew, so it is an ORDER, not an estimate: the pay math
        // splits it evenly instead of running the tier calculation, and the job
        // page labels it "Manual amount" rather than "not used".
        employeePayIsManual: !!teamPayout,
        requiredCleaners: Math.max(1, providers.length),
        bookingSource: BOOKING_SOURCE,
        // As in the in-app importer: the CSV's service total already includes
        // the extras, so an imported job is FINAL_PRICE and its add-on rows
        // itemise that total rather than adding to it (fix 2).
        pricingMode: "FINAL_PRICE" as const,
        externalBookingId: bkBookingId || null,
        notes: customerNote,
        ...(cleanerIds.length
          ? {
              // Use the relation connect — Prisma forbids the scalar employeeId
              // alongside the other nested relation writes on the same create.
              employee: { connect: { id: cleanerIds[0] } },
              cleaners: { connect: cleanerIds.map((id) => ({ id })) },
            }
          : {}),
      };

      if (!COMMIT) {
        jobTally.created++;
        note(
          `  + row ${rowNum}: ${clientName} · ${jobType} · ${start
            .toISOString()
            .slice(0, 16)} · $${serviceTotal} · ${status} · ${cleanerIds.length || providers.length}cl  [dry-run]`
        );
        continue;
      }

      // Persisted dedup guard — makes re-runs safe. Prefer the unique Booking id;
      // fall back to customer+start-time only for rows with no Booking id.
      if (bkBookingId) {
        const dup = await db.job.findFirst({
          where: { externalBookingId: bkBookingId, bookingSource: BOOKING_SOURCE },
          select: { id: true },
        });
        if (dup) {
          jobTally.skipped++;
          note(`  ↷ row ${rowNum}: already imported (booking ${bkBookingId})`);
          continue;
        }
      } else if (clientId) {
        const dup = await db.job.findFirst({
          where: { clientId, startTime: start, bookingSource: BOOKING_SOURCE },
          select: { id: true },
        });
        if (dup) {
          jobTally.skipped++;
          note(`  ↷ row ${rowNum}: already imported (skip)`);
          continue;
        }
      }

      const createdJob = await db.job.create({ data });
      await db.jobLog
        .create({
          data: { jobId: createdJob.id, action: "NOTE_ADDED", description: importNote },
        })
        .catch(() => {});
      jobTally.created++;
    } catch (e) {
      jobTally.failed++;
      note(`  ✗ row ${rowNum} FAILED: ${(e as Error).message}`);
    }
  }

  // ── final report ──
  note(`\n${"=".repeat(70)}\nSUMMARY (${COMMIT ? "COMMITTED" : "DRY RUN"})`);
  note("=".repeat(70));
  note(
    `Cleaners : ${cleanerTally.created} created, ${cleanerTally.existing} existing, ${cleanerTally.skipped} skipped (no email), ${cleanerTally.failed} failed`
  );
  note(
    `Customers: ${custTally.created} created, ${custTally.existing} existing, ${custTally.failed} failed  ·  ${
      COMMIT ? `${addressesCreated} addresses stored` : `${distinctAddresses} addresses to store`
    }`
  );
  note(
    `Jobs     : ${jobTally.created} created, ${jobTally.skipped} skipped (dedup/already), ${jobTally.failed} failed`
  );
  note(`Job status breakdown: ${JSON.stringify(statusCounts)}`);
  note(
    `  → PAID=green · SCHEDULED+assigned=dark blue · unassigned=pink · CREATED=on hold ($0)`
  );
  if (SEND_EMAILS) {
    note(
      `Emails: ${emailStats.sent} accepted by Resend, ${emailStats.failed} failed ` +
        `(of ${cleanerCreds.length} cleaner + ${custCreds.length} customer welcome attempts). ` +
        `Note: "accepted" ≠ inbox — check Resend dashboard for bounces/spam.`
    );
  } else if (COMMIT) {
    note(`Emails: SUPPRESSED (--no-emails). Temp passwords were set but not sent.`);
  } else {
    note(`Emails: none (dry-run). Would send cleaner + customer login emails on --commit.`);
  }
  note(`Booking-confirmation emails: NEVER sent. Stripe: NEVER touched.`);

  if (PRINT_CREDS && (cleanerCreds.length || custCreds.length)) {
    note(`\n${"─".repeat(70)}\nGENERATED TEMP PASSWORDS (debug — do not use on the real import):`);
    for (const c of cleanerCreds) note(`  cleaner  ${c.email}  →  ${c.tempPassword}`);
    for (const c of custCreds) note(`  customer ${c.email}  →  ${c.tempPassword}`);
  }

  if (!COMMIT) {
    note(
      `\nThis was a DRY RUN — nothing was written. Re-run with --commit to import for real.`
    );
  }

  await db.$disconnect();
}

// ── email helpers ────────────────────────────────────────────────────────────
// Self-contained Resend sends (no app-module path-alias dependency). These are
// operational migration emails, so they bypass the Settings → Notifications
// gate by design — only account/login emails go out, never booking receipts.
import { Resend } from "resend";

const FROM = process.env.EMAIL_FROM ?? "Cleano <no-reply@cleano.ca>";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.cleano.ca";
let _resend: Resend | null | undefined;
function getResend(): Resend | null {
  if (_resend !== undefined) return _resend;
  _resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  if (!_resend) note(`    (email) RESEND_API_KEY not set — emails skipped`);
  return _resend;
}

function emailLayout(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f2ed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.07)">
<tr><td style="background:#00424a;padding:28px 32px"><span style="color:#fff;font-size:22px;font-weight:700">Cleano</span></td></tr>
<tr><td style="padding:32px">
<h1 style="margin:0 0 12px;font-size:24px;color:#00424a">${title}</h1>${bodyHtml}</td></tr>
<tr><td style="background:#f5f2ed;padding:20px 32px;font-size:12px;color:#888;text-align:center">© ${new Date().getFullYear()} Cleano · care@cleano.ca</td></tr>
</table></td></tr></table></body></html>`;
}
function credBox(email: string, tempPassword: string, loginUrl: string): string {
  return `<table width="100%" style="border:1px solid #eee;border-radius:10px;margin:16px 0"><tr><td style="padding:16px">
<div style="font-size:13px;color:#666">Email</div><div style="font-size:15px;color:#111;font-weight:600;margin-bottom:10px">${email}</div>
<div style="font-size:13px;color:#666">Temporary password</div><div style="font-size:18px;color:#111;font-weight:700;font-family:monospace;letter-spacing:1px">${tempPassword}</div>
</td></tr></table>
<a href="${loginUrl}" style="display:inline-block;margin-top:8px;padding:12px 28px;background:#00424a;color:#fff;border-radius:8px;text-decoration:none;font-size:15px;font-weight:600">Log in</a>
<p style="margin:16px 0 0;font-size:13px;color:#888">Please change your password after your first login.</p>`;
}

// Real delivery tally (accepted by Resend), so the summary reports truth.
const emailStats = { sent: 0, failed: 0 };
async function sendEmail(to: string, subject: string, html: string) {
  const resend = getResend();
  if (!resend) {
    emailStats.failed++;
    return;
  }
  const { error } = await resend.emails.send({ from: FROM, to, subject, html });
  if (error) {
    emailStats.failed++;
    note(`    (email) ${to} FAILED: ${error.message}`);
  } else {
    emailStats.sent++;
  }
}

async function emailCleanerWelcome(name: string, to: string, tempPassword: string) {
  const first = name.split(" ")[0];
  const html = emailLayout(
    `Welcome to Cleano, ${first}!`,
    `<p style="font-size:15px;line-height:1.6;color:#333">Your Cleano cleaner account is ready. Your upcoming jobs have been imported and are waiting in the app. Sign in to see your schedule, clock in, and get paid.</p>` +
      credBox(to, tempPassword, `${APP_URL}/cleanos/login`)
  );
  await sendEmail(to, "Your Cleano cleaner account is ready", html);
}

async function emailCustomerWelcome(name: string, to: string, tempPassword: string) {
  const first = name.split(" ")[0];
  const html = emailLayout(
    `Your Cleano account is ready, ${first}`,
    `<p style="font-size:15px;line-height:1.6;color:#333">We've moved your bookings over to our new Cleano portal. Log in with the temporary password below — you'll be asked to set your own password right away, then you can view and manage all your upcoming cleanings.</p>` +
      credBox(to, tempPassword, `${APP_URL}/portal/login`)
  );
  await sendEmail(to, "Your Cleano account — log in to manage your bookings", html);
}

/**
 * Ensure a customer has a portal login. If the User already exists (by email)
 * we reuse it; otherwise create User(role CLIENT) + credential account with a
 * temp password and link Client.userId. Returns the temp password only when a
 * fresh credential was minted (so we know whether to email it).
 */
async function ensureCustomerLogin(
  name: string,
  email: string,
  clientId: string
): Promise<{ userId: string; tempPassword: string | null }> {
  const existing = await db.user.findUnique({
    where: { email },
    include: { accounts: true },
  });
  if (existing) {
    if (existing.role !== "CLIENT" && existing.role === "EMPLOYEE") {
      // Don't clobber staff roles; only promote plain EMPLOYEE defaults.
      await db.user.update({ where: { id: existing.id }, data: { role: "CLIENT" } });
    }
    await db.client.update({ where: { id: clientId }, data: { userId: existing.id } });
    const hasCredential = existing.accounts.some((a) => a.providerId === "credential");
    if (hasCredential) return { userId: existing.id, tempPassword: null };
    const tempPassword = makeTempPassword();
    await db.account.create({
      data: {
        userId: existing.id,
        accountId: existing.id,
        providerId: "credential",
        password: await hashPassword(tempPassword),
      },
    });
    // Force them to replace this temp password on first login.
    await db.user.update({
      where: { id: existing.id },
      data: { mustChangePassword: true },
    });
    return { userId: existing.id, tempPassword };
  }
  const tempPassword = makeTempPassword();
  const user = await db.user.create({
    data: {
      name,
      email,
      emailVerified: true,
      isActive: true,
      role: "CLIENT",
      mustChangePassword: true, // forced reset on first login
    },
  });
  await db.account.create({
    data: {
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: await hashPassword(tempPassword),
    },
  });
  await db.client.update({ where: { id: clientId }, data: { userId: user.id } });
  return { userId: user.id, tempPassword };
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
