/**
 * One-time backfill (TODO stage 12.2): give structured add-ons to BookingKoala
 * bookings that were imported BEFORE the importer learned to create them.
 *
 *   npx tsx scripts/backfill-bk-addons.ts <export.csv>            # dry-run
 *   npx tsx scripts/backfill-bk-addons.ts <export.csv> --commit   # apply
 *
 * ## Why a script and not a re-import
 *
 * Re-uploading the same CSV fixes nothing. `runBookingKoalaImport` dedupes on
 * `externalBookingId` and `continue`s before its create — there is no update
 * path, deliberately (see the nested-create comment in that file). So a booking
 * imported before the add-on fix has zero `JobAddOn` rows *permanently*, and
 * every re-run skips it as a duplicate. That is the entire complaint behind
 * item 22: the importer is right, the historical rows are not.
 *
 * ## What makes it safe to re-run
 *
 * A job is written to ONLY when it currently has no add-on rows at all, and
 * that check is re-read inside the same transaction as the insert. So:
 *
 *   * a job imported after the fix (rows already present) is never touched —
 *     no doubling up;
 *   * a second run of this script creates 0 rows;
 *   * two runs racing each other cannot both insert, because the count and the
 *     insert share a transaction.
 *
 * It is additive only. Nothing is updated, nothing is deleted.
 *
 * ## No new parsing
 *
 * `parseBkAddOns` (the five columns, the paren-depth split, the `(N)`
 * quantities, the cross-column merge) and `resolveBkAddOns` (catalog matching,
 * canonical names, `price: 0`) are imported from the same modules the importer
 * uses. This file only decides WHICH jobs to write to. If the parse rules
 * change, this script changes with them, because there is no second copy.
 *
 * `price: 0` is not a placeholder to fix later — an imported job's subtotal is
 * the CSV's "Service total", which already includes the extras. Pricing these
 * rows would bill the job for them twice. See resolveBkAddOns.
 */
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import {
  parseCSV,
  parseBkAddOns,
  clean,
  BOOKING_SOURCE,
  type BkAddOn,
} from "../src/lib/bookingkoala/core";
import { normalizeAddOnCatalog, resolveBkAddOns } from "../src/lib/addon-catalog";

const db = new PrismaClient();
const args = process.argv.slice(2);
const commit = args.includes("--commit");
const csvPath = args.find((a) => !a.startsWith("--"));

/** Stable prefix on the audit log this writes — also the human-readable marker. */
const BACKFILL_MARKER = "Add-ons backfilled from the original BookingKoala export.";

interface CsvBooking {
  rowNum: number;
  bookingId: string;
  customer: string;
  addOns: BkAddOn[];
}

/**
 * Read the export the way the importer reads it, but only as far as add-ons.
 *
 * Deliberately NOT `parseAndNormalize`: that drops rows with an unreadable
 * start date (correct for creating a job — one cannot exist without a start
 * time) and this pass never creates a job. A row whose date column is mangled
 * may still carry a booking id that matches a job imported from a cleaner copy
 * of the file, and its add-ons are just as real.
 */
function readBookings(csvText: string): {
  bookings: CsvBooking[];
  totalRows: number;
  noBookingId: number;
  duplicateIds: number;
  missingColumns: string[];
} {
  const rows = parseCSV(csvText);
  const header = (rows[0] ?? []).map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const dataRows = rows.slice(1).filter((r) => r.length > 1);

  // Every add-on column is read by header NAME. Say plainly which ones this
  // file lacks — a BookingKoala export missing "Extras" parses to zero add-ons
  // and would otherwise look like "there was nothing to backfill".
  const missingColumns = ["Extras", "Items", "Packages", "Package addons", "Addons"].filter(
    (c) => idx(c) === -1
  );

  const byId = new Map<string, CsvBooking>();
  let noBookingId = 0;
  let duplicateIds = 0;

  dataRows.forEach((r, i) => {
    const get = (name: string) => r[idx(name)] ?? "";
    const bookingId = clean(get("Booking id"));
    if (!bookingId) {
      noBookingId++;
      return;
    }
    // First occurrence wins — the same rule the importer's `seen` set applies,
    // so a file listing a booking twice cannot produce two sets of add-ons.
    if (byId.has(bookingId)) {
      duplicateIds++;
      return;
    }
    byId.set(bookingId, {
      rowNum: i + 2, // header is row 1
      bookingId,
      customer: clean(get("Full name")) || clean(get("Email")) || "(unknown)",
      addOns: parseBkAddOns(get),
    });
  });

  return {
    bookings: [...byId.values()],
    totalRows: dataRows.length,
    noBookingId,
    duplicateIds,
    missingColumns,
  };
}

/**
 * The add-on catalog, read the way `getBookingConfig` reads it.
 *
 * Read here rather than imported from getBookingConfig because that module is
 * `"use server"` and pulls in the whole settings/pricing stack. The icon-key
 * set is deliberately NOT passed: it lives in a lucide-importing module, and
 * icons play no part in name matching (they only gate `entry.icon`, which this
 * script never reads).
 */
async function loadCatalog(): Promise<{ name: string }[]> {
  const setting = await db.appSetting.findUnique({ where: { key: "pricing.addOns" } });
  if (!setting || !Array.isArray(setting.value)) return [];
  return normalizeAddOnCatalog(setting.value);
}

async function main() {
  if (!csvPath) {
    console.error(
      "Usage: npx tsx scripts/backfill-bk-addons.ts <export.csv> [--commit]\n" +
        "Pass the ORIGINAL BookingKoala export that produced the imported jobs."
    );
    process.exit(1);
  }
  const resolved = path.resolve(process.cwd(), csvPath);
  if (!fs.existsSync(resolved)) {
    console.error(`No such file: ${resolved}`);
    process.exit(1);
  }

  const { bookings, totalRows, noBookingId, duplicateIds, missingColumns } = readBookings(
    fs.readFileSync(resolved, "utf8")
  );

  console.log(`Read ${totalRows} data row(s) from ${path.basename(resolved)}.`);
  if (missingColumns.length) {
    console.log(
      `  ⚠ Add-on column(s) absent from this export: ${missingColumns.join(", ")}. ` +
        `Add-ons that lived only in those columns cannot be recovered from this file.`
    );
  }
  if (noBookingId) {
    console.log(
      `  ${noBookingId} row(s) carry no "Booking id" — they cannot be matched to a job and are skipped.`
    );
  }
  if (duplicateIds) {
    console.log(`  ${duplicateIds} row(s) repeat a booking id already seen (first occurrence used).`);
  }

  const withAddOns = bookings.filter((b) => b.addOns.length > 0);
  console.log(
    `${bookings.length} distinct booking(s) in the file; ${withAddOns.length} of them carry add-ons.`
  );
  if (withAddOns.length === 0) {
    console.log("Nothing to backfill from this file.");
    return;
  }

  // ── match to imported jobs ────────────────────────────────────────────────
  const jobs = await db.job.findMany({
    where: {
      bookingSource: BOOKING_SOURCE,
      externalBookingId: { in: withAddOns.map((b) => b.bookingId) },
    },
    select: {
      id: true,
      externalBookingId: true,
      clientName: true,
      startTime: true,
      deletedAt: true,
      _count: { select: { addOns: true } },
    },
  });

  const jobsById = new Map<string, typeof jobs>();
  for (const j of jobs) {
    const key = j.externalBookingId as string;
    jobsById.set(key, [...(jobsById.get(key) ?? []), j]);
  }

  const catalog = await loadCatalog();
  console.log(`Add-on catalog: ${catalog.length} entr(ies) in Settings → Pricing → Add-Ons.`);

  type Plan = {
    booking: CsvBooking;
    jobId: string;
    clientName: string;
    rows: { name: string; price: number; quantity: number }[];
    review: BkAddOn[];
  };
  const plans: Plan[] = [];
  const unmatchedBookings: CsvBooking[] = [];
  const archivedOnly: CsvBooking[] = [];
  const ambiguous: CsvBooking[] = [];
  const alreadyHaveRows: CsvBooking[] = [];

  for (const b of withAddOns) {
    const all = jobsById.get(b.bookingId) ?? [];
    if (all.length === 0) {
      unmatchedBookings.push(b);
      continue;
    }
    // Archived jobs are left alone, mirroring the importer's `deletedAt: null`
    // dedupe: a soft-deleted booking is re-importable, and that re-import will
    // create its add-ons itself.
    const live = all.filter((j) => j.deletedAt === null);
    if (live.length === 0) {
      archivedOnly.push(b);
      continue;
    }
    // `externalBookingId` is indexed, not unique. Two live jobs sharing one
    // booking id is a data problem this script must not guess its way through.
    if (live.length > 1) {
      ambiguous.push(b);
      continue;
    }
    const job = live[0];
    if (job._count.addOns > 0) {
      alreadyHaveRows.push(b);
      continue;
    }
    const { rows, review } = resolveBkAddOns(b.addOns, catalog);
    plans.push({ booking: b, jobId: job.id, clientName: job.clientName, rows, review });
  }

  const rowsToCreate = plans.reduce((s, p) => s + p.rows.length, 0);
  const reviewNames = new Map<string, number>();
  for (const p of plans) {
    for (const a of p.review) reviewNames.set(a.name, (reviewNames.get(a.name) ?? 0) + 1);
  }

  console.log(
    `\nMatched to a live imported job: ${plans.length + alreadyHaveRows.length}\n` +
      `  ${alreadyHaveRows.length} already have add-on rows — skipped (this is what makes re-running safe)\n` +
      `  ${plans.length} have none — ${rowsToCreate} JobAddOn row(s) to create`
  );
  if (unmatchedBookings.length) {
    console.log(
      `Not in the database: ${unmatchedBookings.length} booking(s) with add-ons were never imported ` +
        `(e.g. ${unmatchedBookings.slice(0, 3).map((b) => b.bookingId).join(", ")}).`
    );
  }
  if (archivedOnly.length) {
    console.log(`Archived (soft-deleted) job only: ${archivedOnly.length} booking(s) — left untouched.`);
  }
  if (ambiguous.length) {
    console.log(
      `⚠ Ambiguous: ${ambiguous.length} booking id(s) match more than one live job — skipped, ` +
        `resolve by hand: ${ambiguous.map((b) => b.bookingId).join(", ")}`
    );
  }
  if (reviewNames.size) {
    console.log(
      `\n${reviewNames.size} add-on name(s) have no catalog match. They are still created — nothing is ` +
        `dropped — but carry no price, so add them in Settings → Pricing → Add-Ons if they should have one:`
    );
    for (const [name, n] of [...reviewNames.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)} × ${name}`);
    }
  }

  // A sample of what would be written — a one-way write to live data should not
  // be approved from counts alone.
  console.log("\nSample of what would be written:");
  for (const p of plans.slice(0, 5)) {
    console.log(
      `  booking ${p.booking.bookingId} · ${p.clientName} (job ${p.jobId})\n` +
        `    ${p.rows.map((r) => (r.quantity > 1 ? `${r.name} ×${r.quantity}` : r.name)).join(", ")}`
    );
  }

  if (!commit) {
    console.log(
      `\nDry-run only — nothing written. Re-run with --commit to create ${rowsToCreate} row(s) ` +
        `across ${plans.length} job(s).`
    );
    return;
  }

  let jobsWritten = 0;
  let rowsWritten = 0;
  let raced = 0;
  const failures: string[] = [];
  for (const p of plans) {
    try {
      const written = await db.$transaction(async (tx) => {
        // Re-read INSIDE the transaction. The count taken during planning is a
        // snapshot; this is the check that actually guarantees a job can never
        // end up with two sets of add-ons.
        const existing = await tx.jobAddOn.count({ where: { jobId: p.jobId } });
        if (existing > 0) return 0;
        await tx.jobAddOn.createMany({
          data: p.rows.map((r) => ({ jobId: p.jobId, ...r })),
        });
        await tx.jobLog.create({
          data: {
            jobId: p.jobId,
            // NOTE_ADDED is excluded from the customer portal feed, so this
            // traceability line stays admin-only — same as the import's own.
            action: "NOTE_ADDED",
            description:
              `${BACKFILL_MARKER} Source file: ${path.basename(resolved)}, booking ` +
              `${p.booking.bookingId} (row ${p.booking.rowNum}). Created: ` +
              p.rows
                .map((r) => (r.quantity > 1 ? `${r.name} ×${r.quantity}` : r.name))
                .join(", ") +
              `. Priced at $0 — the imported service total already covers them.`,
          },
        });
        return p.rows.length;
      });
      if (written === 0) {
        raced++;
        continue;
      }
      jobsWritten++;
      rowsWritten += written;
    } catch (e) {
      failures.push(`booking ${p.booking.bookingId}: ${(e as Error).message}`);
    }
  }

  console.log(
    `\nBackfilled ${rowsWritten} add-on row(s) across ${jobsWritten} job(s).` +
      (raced ? ` ${raced} job(s) gained add-ons between planning and writing — left alone.` : "") +
      (failures.length ? `\n${failures.length} failure(s):\n  ${failures.slice(0, 20).join("\n  ")}` : "")
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
