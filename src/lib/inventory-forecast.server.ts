import { db } from "@/lib/org-db";
import {
  USAGE_WINDOW_DAYS,
  perJobAverages,
  type PerJobAverageOptions,
} from "./inventory-forecast";

/**
 * The one query behind every actuals-based usage figure (awerfixes.pdf item 14).
 *
 * Split from the pure module for the usual reason — that one has to stay
 * importable by the verify script and by client bundles, so it cannot touch
 * `db`. Everything that used to read `InventoryRule.usagePerJob` comes through
 * here instead: the inventory forecast, the per-employee forecast, the calendar
 * "missing equipment" badge, and the required-equipment checks on the admin and
 * cleaner job views. One loader, one window, no chance of two surfaces quoting
 * different numbers for the same product.
 *
 * Filtered in SQL on `Job.jobDate` rather than pulling the whole table and
 * filtering in memory: the window is the selective part, and `JobProductUsage`
 * grows a row per product per job forever.
 */
export async function loadPerJobAverages(
  options: PerJobAverageOptions = {}
): Promise<Map<string, number>> {
  const windowDays = options.windowDays ?? USAGE_WINDOW_DAYS;
  const now = options.now ?? new Date();
  const from = new Date(now.getTime() - windowDays * 86400000);

  const rows = await db.jobProductUsage.findMany({
    where: { job: { jobDate: { gte: from, lte: now } } },
    select: {
      productId: true,
      jobId: true,
      quantity: true,
      job: { select: { jobDate: true } },
    },
  });

  return perJobAverages(
    rows.map((r) => ({
      productId: r.productId,
      jobId: r.jobId,
      quantity: r.quantity,
      jobDate: r.job.jobDate,
    })),
    { now, windowDays }
  );
}
