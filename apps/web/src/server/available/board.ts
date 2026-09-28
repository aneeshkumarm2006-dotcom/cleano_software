// The available-jobs board and its preview, shared by the web
// (cleaners/available-jobs/page.tsx, getAvailableJobPreview) and the phone
// (GET /api/v1/jobs/available, GET /api/v1/jobs/available/:id).
//
// What a job must pass to be on a cleaner's board is decided ONCE, here, from
// the same rule claimJob enforces:
//   1. claimableJobsWhere(caller, now) — not deleted, not started, open for
//      claim, quote settled, not already the caller's;
//   2. fewer cleaners than requiredCleaners;
//   3. isCategoryAllowed(jobType, caller's categories).
// 2 and 3 can't be said in SQL (a relation count; a free-text job type read
// through an alias map), so they run in JS, and they run BEFORE pagination.
//
// PRIVACY: the phone's answers carry the area only (neighbourhood or city),
// never the street, unit, postal code, client, access notes, price or anyone
// else's pay. The web's preview still shows its street address and client
// name, as it always has; those fields are read here but only the web's
// adapter passes them on.
import "server-only";

import type { AvailableJobDetailResponse, AvailableJobSummary, AvailableJobsResponse } from "@bookmops/api/v1";
import { resolveChecklistTemplates, sanitizeCleanerNotes } from "@bookmops/core/jobs";
import { computeJobPayout, fallbackRateInput, type CleanerRateInput } from "@bookmops/core/pay";
import { propertyTypeLabel } from "@bookmops/core/property";
import { isCategoryAllowed, jobTypeLabel, normalizeJobType } from "@bookmops/core/services";
import type { Prisma } from "@prisma/client";

import { claimableJobsWhere } from "@/lib/cleaner-jobs";
import { getCleanerRateInputs } from "@/lib/cleaner-rates";
import { addOnQuantity } from "@/lib/job-money";
import { db } from "@/lib/org-db";
import { getServiceCatalogWithLabels } from "@/lib/service-catalog.server";
import { storeCivilDayRange, storeDateKey, storeWeekday } from "@/lib/timezone";
import { toCents } from "@/lib/withdrawal-rules";

import type { Actor } from "../actor";
import { jobArea } from "../jobs/area";
import { decodeCursor, encodeCursor } from "../jobs/list";
import { failure, notFound, ok, type Result } from "../result";

export const AVAILABLE_PAGE_SIZE = 20;
/** Rows read per pass while filling a page past the JS-side filters. */
const SCAN_BATCH = 200;
/** A ceiling on passes per page, far past any real board (10,000 rows). */
const MAX_SCAN_PASSES = 50;

// ── The shared rule ──────────────────────────────────────────────────────────

/** Steps 2 and 3 of the board rule: a spot left, and a category the caller may work. */
export function isOpenForCaller(
  job: { jobType: string | null; requiredCleaners: number; cleaners: { id: string }[] },
  allowedCategories: readonly string[] | null | undefined,
): boolean {
  return job.cleaners.length < job.requiredCleaners && isCategoryAllowed(job.jobType, allowedCategories as string[]);
}

/** The caller's approved service categories. Empty means unrestricted. */
export async function allowedCategoriesOf(userId: string): Promise<string[]> {
  const me = await db.user.findUnique({ where: { id: userId }, select: { allowedServiceCategories: true } });
  return me?.allowedServiceCategories ?? [];
}

/**
 * This cleaner's own estimate, from the same payout math payroll uses: their
 * tier and rating rate on the full price for PERCENTAGE jobs; the rate for
 * HOURLY; nothing for FLAT, which dispatch sets per assignment. Never
 * `price / crew`, and the price itself never leaves the server.
 */
export function estimateFor(
  job: { payType: string; price: number | null; hourlyRate: number | null },
  cleanerId: string,
  rate: CleanerRateInput | undefined,
): { estPay: number | null; estHourly: number | null } {
  if (job.payType === "HOURLY") return { estPay: null, estHourly: job.hourlyRate ?? null };
  if (job.payType === "PERCENTAGE" && job.price != null && job.price > 0) {
    const payout = computeJobPayout(job.price, [rate ?? fallbackRateInput(cleanerId)]);
    return { estPay: payout.shares.find((s) => s.id === cleanerId)?.amount ?? null, estHourly: null };
  }
  return { estPay: null, estHourly: null };
}

// ── GET /api/v1/jobs/available ───────────────────────────────────────────────

export type AvailableWhenFilter = "all" | "week" | "weekend";

const BOARD_SELECT = {
  id: true,
  startTime: true,
  endTime: true,
  isFlexible: true,
  location: true,
  jobType: true,
  price: true,
  payType: true,
  hourlyRate: true,
  bedCount: true,
  bathCount: true,
  propertyType: true,
  requiredCleaners: true,
  cleaners: { select: { id: true } },
  clientAddress: { select: { city: true } },
} satisfies Prisma.JobSelect;

type BoardRow = Prisma.JobGetPayload<{ select: typeof BOARD_SELECT }>;

/** "YYYY-MM-DD" plus n calendar days. */
function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

function toBoardSummary(
  j: BoardRow,
  labels: Record<string, string>,
  cleanerId: string,
  rate: CleanerRateInput | undefined,
): AvailableJobSummary {
  const { estPay, estHourly } = estimateFor(j, cleanerId, rate);
  return {
    id: j.id,
    startsAt: j.startTime.toISOString(),
    endsAt: j.endTime ? j.endTime.toISOString() : null,
    isFlexible: j.isFlexible,
    area: jobArea(j),
    service: {
      category: normalizeJobType(j.jobType) ?? "OTHER",
      label: jobTypeLabel(j.jobType, labels) || "Cleaning",
    },
    property: {
      type: propertyTypeLabel(j.propertyType),
      beds: j.bedCount,
      baths: j.bathCount,
    },
    pay: {
      type: j.payType as AvailableJobSummary["pay"]["type"],
      estimateCents: estPay != null ? toCents(estPay) : null,
      hourlyRateCents: estHourly != null ? toCents(estHourly) : null,
    },
    crew: { required: j.requiredCleaners, claimed: j.cleaners.length },
  };
}

export async function listAvailableJobs(
  actor: Actor,
  input: { when: AvailableWhenFilter; cursor?: string },
  now: Date,
): Promise<Result<AvailableJobsResponse>> {
  const cursor = decodeCursor(input.cursor);
  if (cursor === "invalid") return failure(400, "VALIDATION_FAILED", "That page link isn't valid. Refresh and try again.");

  const allowed = await allowedCategoriesOf(actor.userId);

  const base = claimableJobsWhere(actor.userId, now);
  const narrow: Prisma.JobWhereInput[] = [...((base.AND as Prisma.JobWhereInput[]) ?? [])];
  if (input.when === "week") {
    // Today through six days on, by the start's date in the company's zone.
    const lastDay = addDays(storeDateKey(now), 6);
    narrow.push({ startTime: { lt: storeCivilDayRange(lastDay).end } });
  }
  const inWhen = (j: BoardRow) => {
    if (input.when !== "weekend") return true;
    const wd = storeWeekday(j.startTime);
    return wd === 0 || wd === 6;
  };

  const picked: BoardRow[] = [];
  let after: { s: Date; id: string } | null = cursor ? { s: new Date(cursor.s), id: cursor.id } : null;
  let exhausted = false;
  let lastScanned: BoardRow | null = null;

  for (let pass = 0; pass < MAX_SCAN_PASSES && picked.length <= AVAILABLE_PAGE_SIZE; pass++) {
    // A cursor only narrows the scoped query; it can never widen it.
    const where: Prisma.JobWhereInput = {
      ...base,
      AND: [
        ...narrow,
        ...(after
          ? [{ OR: [{ startTime: { gt: after.s } }, { startTime: after.s, id: { gt: after.id } }] }]
          : []),
      ],
    };
    const rows = await db.job.findMany({
      where,
      orderBy: [{ startTime: "asc" }, { id: "asc" }],
      take: SCAN_BATCH,
      select: BOARD_SELECT,
    });
    for (const r of rows) {
      lastScanned = r;
      if (isOpenForCaller(r, allowed) && inWhen(r)) {
        picked.push(r);
        if (picked.length > AVAILABLE_PAGE_SIZE) break;
      }
    }
    if (rows.length < SCAN_BATCH) {
      exhausted = true;
      break;
    }
    const last = rows[rows.length - 1];
    after = { s: last.startTime, id: last.id };
  }

  const more = picked.length > AVAILABLE_PAGE_SIZE;
  const page = more ? picked.slice(0, AVAILABLE_PAGE_SIZE) : picked;
  // A full page: continue after its last item. A page cut short by the scan
  // ceiling (never on a real board): continue after the last row scanned, so
  // nothing further on is lost.
  const resumeAt = more ? page[page.length - 1] : !exhausted && lastScanned ? lastScanned : null;

  const [{ labels }, rates] = await Promise.all([
    getServiceCatalogWithLabels(),
    getCleanerRateInputs([actor.userId]),
  ]);
  const rate = rates.get(actor.userId);

  return ok({
    items: page.map((j) => toBoardSummary(j, labels, actor.userId, rate)),
    nextCursor: resumeAt ? encodeCursor({ s: resumeAt.startTime.toISOString(), id: resumeAt.id }) : null,
  });
}

// ── The preview (web getAvailableJobPreview, GET /api/v1/jobs/available/:id) ─

const PREVIEW_SELECT = {
  id: true,
  jobNumber: true,
  clientName: true,
  startTime: true,
  endTime: true,
  isFlexible: true,
  location: true,
  aptNumber: true,
  // The job's own postal-code snapshot (item 2).
  postalCode: true,
  jobType: true,
  price: true,
  payType: true,
  hourlyRate: true,
  bedCount: true,
  bathCount: true,
  halfBathCount: true,
  squareFootage: true,
  propertyType: true,
  // Stage 10 — inputs to the shared checklist resolution. Scalars only: the
  // `client` relation is never selected (the preview withholds customer
  // contact details), and the resolver only needs the ids.
  clientId: true,
  clientAddressId: true,
  checklistTemplateId: true,
  customChecklist: true,
  requiredCleaners: true,
  notes: true,
  addOns: { select: { name: true, quantity: true } },
  cleaners: { select: { id: true } },
  // City / postal only — NOT accessNotes.
  clientAddress: { select: { aptNumber: true, city: true, postalCode: true } },
} satisfies Prisma.JobSelect;

export type PreviewJob = Prisma.JobGetPayload<{ select: typeof PREVIEW_SELECT }>;

export interface AvailablePreview {
  job: PreviewJob;
  serviceLabel: string | null;
  estPay: number | null;
  estHourly: number | null;
  checklists: { name: string; itemCount: number; requiredCount: number }[];
  durationMinutes: number | null;
}

export type PreviewRefusal = "NOT_AVAILABLE" | "FULLY_STAFFED" | "CATEGORY_NOT_ALLOWED";

/**
 * One job as the board would show it, READ-ONLY: previewing never locks,
 * holds, assigns or hides the job, and never creates a checklist (templates
 * are matched, not instantiated). The claimable rule IS the visibility rule,
 * so a job that can't be claimed can't be previewed.
 */
export async function loadAvailablePreview(
  actor: Actor,
  jobId: string,
  now: Date,
): Promise<{ ok: true; preview: AvailablePreview } | { ok: false; reason: PreviewRefusal }> {
  const job = await db.job.findFirst({
    where: { AND: [{ id: jobId }, claimableJobsWhere(actor.userId, now)] },
    select: PREVIEW_SELECT,
  });
  if (!job) return { ok: false, reason: "NOT_AVAILABLE" };
  // Capacity is a relation count, which the shared where-clause can't express.
  if (job.cleaners.length >= job.requiredCleaners) return { ok: false, reason: "FULLY_STAFFED" };
  if (!isCategoryAllowed(job.jobType, await allowedCategoriesOf(actor.userId))) {
    return { ok: false, reason: "CATEGORY_NOT_ALLOWED" };
  }

  const [{ labels }, rateInputs, templates] = await Promise.all([
    getServiceCatalogWithLabels(),
    getCleanerRateInputs([actor.userId]),
    db.checklistTemplate.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        jobType: true,
        addOnName: true,
        clientId: true,
        clientAddressId: true,
        items: { select: { isRequired: true } },
      },
    }),
  ]);

  const { estPay, estHourly } = estimateFor(job, actor.userId, rateInputs.get(actor.userId));

  // Step 10.7 — the SAME resolver the claim's checklist generation runs, so the
  // preview can never advertise a list the job won't actually get.
  const checklists = resolveChecklistTemplates(templates, {
    jobType: job.jobType,
    addOnNames: job.addOns.map((a) => a.name),
    clientId: job.clientId,
    clientAddressId: job.clientAddressId,
    checklistTemplateId: job.checklistTemplateId,
  }).templates.map((t) => ({
    name: t.name,
    itemCount: t.items.length,
    requiredCount: t.items.filter((i) => i.isRequired).length,
  }));

  return {
    ok: true,
    preview: {
      job,
      serviceLabel: jobTypeLabel(job.jobType, labels) || null,
      estPay,
      estHourly,
      checklists,
      durationMinutes:
        job.endTime && job.startTime
          ? Math.max(0, Math.round((job.endTime.getTime() - job.startTime.getTime()) / 60_000))
          : null,
    },
  };
}

/** GET /api/v1/jobs/available/:id — the preview, minus the street and the client. */
export async function availableJobDetailFor(
  actor: Actor,
  jobId: string,
  now: Date,
): Promise<Result<AvailableJobDetailResponse>> {
  const r = await loadAvailablePreview(actor, jobId, now);
  // Every refusal is the same 404: a job that can't be claimed can't be
  // previewed, and ids can't be probed.
  if (!r.ok) return notFound("This job isn't available any more.");
  const { job, estPay, estHourly, checklists, durationMinutes, serviceLabel } = r.preview;

  return ok({
    id: job.id,
    startsAt: job.startTime.toISOString(),
    endsAt: job.endTime ? job.endTime.toISOString() : null,
    isFlexible: job.isFlexible,
    area: jobArea(job),
    service: {
      category: normalizeJobType(job.jobType) ?? "OTHER",
      label: serviceLabel || "Cleaning",
    },
    property: {
      type: propertyTypeLabel(job.propertyType),
      beds: job.bedCount,
      baths: job.bathCount,
      halfBaths: job.halfBathCount,
      squareFeet: job.squareFootage,
    },
    pay: {
      type: job.payType as AvailableJobDetailResponse["pay"]["type"],
      estimateCents: estPay != null ? toCents(estPay) : null,
      hourlyRateCents: estHourly != null ? toCents(estHourly) : null,
    },
    crew: { required: job.requiredCleaners, claimed: job.cleaners.length },
    plannedMinutes: durationMinutes,
    addOns: job.addOns.map((a) => ({ name: a.name, quantity: addOnQuantity(a) })),
    checklists,
    notes: sanitizeCleanerNotes(job.notes) || null,
  });
}
