"use server";

/**
 * Sales-rep commissions — client feedback item 20, Stage 11.2.
 *
 *   "for sales leads, I wanted to add another section over here that is for
 *    commissions, for commissions on sales reps etc. If we're paying them any
 *    commissions, we could track it over here."
 *
 * That one sentence is the whole brief, so this is a ledger and nothing more:
 * record what is owed, see it totalled per rep, mark it paid. No rule engine —
 * nothing in the app knows which rep sourced a booking, so there is nothing to
 * derive an amount from, and inventing a rule would be this stage making up a
 * compensation policy. ⚠ Scope is a guess pending client detail.
 */

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/org-db";
import { revalidatePath } from "next/cache";
import { storeMonthPeriod } from "@/lib/timezone";
import { SALES_REP_ROLES, type CommissionRow } from "@/app/admin/sales/commissionTypes";

type Result = { success: true; id?: string } | { error: string };

/**
 * Save returns the whole saved row, not just its id. The tab paints the change
 * before `router.refresh()` lands (see CommissionManager), and it cannot build
 * the row itself: the rep's name, the job id behind a typed job NUMBER and the
 * lead's label are all resolved here. Reconstructing them client-side would be
 * a second, drifting copy of that resolution.
 */
type SaveResult = { success: true; row: CommissionRow } | { error: string };

/** Paid/unpaid moves report the timestamp they wrote, so the row's "Paid Aug 13"
 *  is the stored date rather than a client clock's guess at it. */
type PaidResult = { success: true; paidAt: string | null } | { error: string };

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

async function requireAdmin(): Promise<{ name: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") return { error: "Forbidden" };
  return { name: session.user.name ?? "Admin" };
}

export interface CommissionInput {
  id?: string;
  salesRepId: string;
  amount: string | number;
  rate?: string | number | null;
  period?: string | null;
  note?: string | null;
  /** The job's human-facing number, as typed — resolved to an id here. */
  jobNumber?: string | number | null;
  leadId?: string | null;
}

export async function saveCommission(input: CommissionInput): Promise<SaveResult> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;

  const salesRepId = (input.salesRepId ?? "").trim();
  if (!salesRepId) return { error: "Pick a sales rep" };
  const rep = await db.user.findFirst({
    where: { id: salesRepId, deletedAt: null, role: { in: SALES_REP_ROLES } },
    select: { id: true, name: true },
  });
  if (!rep) return { error: "That sales rep no longer exists" };

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    return { error: "Enter an amount (a negative amount records a clawback)" };
  }

  let rate: number | null = null;
  if (input.rate !== undefined && input.rate !== null && `${input.rate}`.trim() !== "") {
    rate = Number(input.rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      return { error: "Rate must be a percentage between 0 and 100" };
    }
  }

  // Default to the month it is *in the store*, not on the server. The host runs
  // UTC, so an entry made at 9 PM on the 31st would otherwise be filed into the
  // following month (Stage 2).
  const period = (input.period ?? "").trim() || storeMonthPeriod();
  if (!PERIOD_RE.test(period)) return { error: "Period must be a month, e.g. 2026-08" };

  // A commission is earned on one thing or on nothing. Allowing both would make
  // "what was this paid for?" ambiguous on the only screen that shows it.
  let jobId: string | null = null;
  let jobNumber: number | null = null;
  const rawJobNumber = `${input.jobNumber ?? ""}`.trim();
  if (rawJobNumber) {
    const typed = Number(rawJobNumber.replace(/^#/, ""));
    if (!Number.isInteger(typed) || typed <= 0) return { error: "Job number must be a whole number" };
    const job = await db.job.findUnique({ where: { jobNumber: typed }, select: { id: true } });
    if (!job) return { error: `No job #${typed}` };
    jobId = job.id;
    jobNumber = typed;
  }

  const leadId: string | null = (input.leadId ?? "").trim() || null;
  let leadLabel: string | null = null;
  if (leadId) {
    if (jobId) return { error: "Link the commission to a job or to a lead, not both" };
    const lead = await db.lead.findFirst({
      where: { id: leadId, deletedAt: null },
      select: { id: true, name: true, email: true },
    });
    if (!lead) return { error: "That lead no longer exists" };
    // Same label the page loader builds, so the optimistic row and the one the
    // refresh brings back are the same row.
    leadLabel = lead.name || lead.email;
  }

  const note = (input.note ?? "").trim().slice(0, 500) || null;

  try {
    const data = { salesRepId, amount, rate, period, note, jobId, leadId };
    const saved = input.id
      ? // paidAt is deliberately untouched here — it is moved only by
        // setCommissionPaid, so editing a note can never silently unpay someone.
        await db.commission.update({
          where: { id: input.id },
          data,
          select: { id: true, paidAt: true, createdAt: true },
        })
      : await db.commission.create({
          data,
          select: { id: true, paidAt: true, createdAt: true },
        });
    revalidatePath("/admin/sales");
    return {
      success: true,
      row: {
        id: saved.id,
        salesRepId,
        salesRepName: rep.name,
        amount,
        rate,
        period,
        note,
        paidAt: saved.paidAt?.toISOString() ?? null,
        createdAt: saved.createdAt.toISOString(),
        jobId,
        jobNumber,
        leadId,
        leadLabel,
      },
    };
  } catch (e) {
    console.error("saveCommission", e);
    return { error: "Failed to save the commission" };
  }
}

export async function setCommissionPaid(id: string, paid: boolean): Promise<PaidResult> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  try {
    const paidAt = paid ? new Date() : null;
    await db.commission.update({ where: { id }, data: { paidAt } });
    revalidatePath("/admin/sales");
    return { success: true, paidAt: paidAt?.toISOString() ?? null };
  } catch (e) {
    console.error("setCommissionPaid", e);
    return { error: "Failed to update the commission" };
  }
}

/** Bulk form of the above — "mark this rep's pending commissions paid". */
export async function markCommissionsPaid(ids: string[]): Promise<PaidResult> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  const list = [...new Set(ids.filter((i) => typeof i === "string" && i.length > 0))];
  if (!list.length) return { error: "Nothing to mark paid" };
  try {
    const paidAt = new Date();
    await db.commission.updateMany({
      where: { id: { in: list }, paidAt: null },
      data: { paidAt },
    });
    revalidatePath("/admin/sales");
    return { success: true, paidAt: paidAt.toISOString() };
  } catch (e) {
    console.error("markCommissionsPaid", e);
    return { error: "Failed to mark those commissions paid" };
  }
}

export async function deleteCommission(id: string): Promise<Result> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  try {
    await db.commission.delete({ where: { id } });
    revalidatePath("/admin/sales");
    return { success: true };
  } catch (e) {
    console.error("deleteCommission", e);
    return { error: "Failed to delete the commission" };
  }
}
