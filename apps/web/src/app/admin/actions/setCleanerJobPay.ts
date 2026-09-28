"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { checkCustomCleanerPay, jobPayBasis } from "@/lib/job-money";

/**
 * Manual per-cleaner pay override for one job (JobAssignment.payAmount).
 *
 * FLAT/HOURLY jobs pay a TEAM TOTAL that is split between the assigned cleaners.
 * This lets an admin split it unevenly — e.g. a $100 job paid $70 / $30 instead
 * of $50 / $50. Cleaners with no override split whatever is left of the total,
 * so the crew can never be paid more than the agreed amount.
 *
 * Passing `amount: null` clears the override and returns that cleaner to the
 * normal rule (even split for FLAT/HOURLY, tier split for PERCENTAGE).
 *
 * The paragraph above — "the crew can never be paid more than the agreed
 * amount" — was only true of the cleaners with NO override, whose share is the
 * floored remainder. The typed amounts themselves were unchecked here until the
 * cap below; see it for the whole story.
 *
 * AUTHZ: OWNER/ADMIN only.
 */
export async function setCleanerJobPay(input: {
  jobId: string;
  cleanerId: string;
  amount: number | null;
}): Promise<{ success: true } | { success: false; error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { success: false, error: "Not authorized" };
  }

  const { jobId, cleanerId } = input;
  if (typeof jobId !== "string" || !jobId) {
    return { success: false, error: "Invalid request" };
  }
  if (typeof cleanerId !== "string" || !cleanerId) {
    return { success: false, error: "Invalid request" };
  }

  let amount: number | null = null;
  if (input.amount !== null && input.amount !== undefined) {
    const n = Number(input.amount);
    if (!Number.isFinite(n) || n < 0 || n > 100_000) {
      return { success: false, error: "Enter a valid amount" };
    }
    amount = Math.round(n * 100) / 100;
  }

  try {
    const job = await db.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        employeeId: true,
        cleaners: { select: { id: true } },
        // Everything the pay cap below needs, and nothing else.
        //
        // The first block is what `jobPayBasis` reads — i.e. every column
        // `computeJobMoney` prices a job from. Forgetting one of them would not
        // fail; it would quietly lower the ceiling (an add-on row nobody
        // counted, an hourly line read off a stale `price` mirror) and start
        // refusing pay the job can actually afford. The tax columns are absent
        // on purpose: the basis is pre-tax and rate-independent.
        price: true,
        discountAmount: true,
        subtotalAmount: true,
        bookingSource: true,
        pricingMode: true,
        addOns: { select: { name: true, price: true, quantity: true } },
        billingType: true,
        billedHourlyRate: true,
        billedEstimatedHours: true,
        billedActualHours: true,
        // The second block decides WHICH total caps the crew: an agreed team
        // total when one has been stated, else what the job itself is worth.
        employeePay: true,
        employeePayIsManual: true,
        payType: true,
        // The other cleaners' existing overrides. The cap is on the crew's
        // TOTAL, so one cleaner's amount can only be judged next to theirs.
        assignments: { select: { cleanerId: true, payAmount: true } },
      },
    });
    if (!job) return { success: false, error: "Job not found" };

    // The cleaner must actually be on this job.
    const onJob =
      job.employeeId === cleanerId ||
      job.cleaners.some((c) => c.id === cleanerId);
    if (!onJob) {
      return { success: false, error: "That cleaner is not on this job" };
    }

    // ── The per-cleaner pay cap, AFTER creation (fix list item #10) ──────────
    //
    // The cap added to /admin/jobs/new covered the creation form and nothing
    // else, so it guarded one of the two writers of `JobAssignment.payAmount`.
    // This is the other one, and it took anything up to $100,000 a head with no
    // warning: $150 + $150 on a $200 job saved clean from the job detail page,
    // `computeJobPayShares` honoured both verbatim, and the overshoot surfaced
    // only afterwards as a −$100 net profit on the Financials tab. A guarantee
    // with a second, unguarded door is not a guarantee.
    //
    // `checkCustomCleanerPay` is the SAME helper the creation path calls, not a
    // second copy of its arithmetic — two copies of this rule is precisely how
    // one of them came to be missing.
    //
    // ## REFUSED, not warned — and why that is still right on an EXISTING job
    //
    // The staffing advisories (availability, service category) warn and never
    // block, because booking a cleaner outside their hours is a judgement call
    // about a person that an admin is allowed to make. This is not that: it is
    // an arithmetic claim about money that cannot be true. The counter-argument
    // for this path — that an admin editing a live job may be correcting an
    // overpayment or honouring an agreed exception — is answered rather than
    // ignored:
    //
    //   * correcting is never refused. The comparison below is against the
    //     job's CURRENT overshoot, so any edit that leaves the crew's total no
    //     worse than it already is goes through, including a partial fix to a
    //     job that is already over (and including every `amount: null` reset,
    //     which can only lower the total).
    //   * an agreed exception is still reachable, in one field: raise the
    //     crew's agreed pay or the job's price on the job form, which records
    //     the decision on the job's money instead of hiding it in payroll. The
    //     error names that escape.
    //
    // Warning instead would leave the money wrong and merely mention it, which
    // on this page means a toast nobody reads against a payroll figure the
    // cleaner's own My Pay screen will show them. Refusing costs an admin one
    // extra edit and cannot silently overpay anybody. `requestWithdrawal` draws
    // the same line for the same reason ("Amount exceeds available balance").
    //
    // The client half of this lives in JobDetailView's pay editor, which
    // disables Save and says the same sentence in place — this is the trust
    // boundary, not the first line of defence.
    const crew = Array.from(
      new Set(
        [job.employeeId, ...job.cleaners.map((c) => c.id)].filter(
          (id): id is string => !!id
        )
      )
    );
    const storedPay = new Map(
      job.assignments.map((a) => [a.cleanerId, a.payAmount ?? null])
    );
    // Only an AGREED total caps anything — the same tri-state saveJob and the
    // creation form use. On a PERCENTAGE job with automatic pay, `employeePay`
    // is a save-time estimate, and capping to an estimate would refuse amounts
    // the tier math itself would have produced.
    const agreedTeamTotal =
      job.employeePayIsManual ||
      job.payType === "FLAT" ||
      job.payType === "HOURLY"
        ? job.employeePay
        : null;
    const payBasis = jobPayBasis(job);
    const checkWith = (override: number | null) =>
      checkCustomCleanerPay({
        payBasis,
        teamTotal: agreedTeamTotal,
        amounts: crew.map((id) =>
          id === cleanerId ? override : (storedPay.get(id) ?? null)
        ),
      });
    const before = checkWith(storedPay.get(cleanerId) ?? null);
    const after = checkWith(amount);
    // Whole cents on both sides, so an edit that changes nothing about the
    // total cannot trip on a float a fraction of a cent high.
    if (
      after.overBudget &&
      Math.round(after.overshoot * 100) > Math.round(before.overshoot * 100)
    ) {
      const ceiling =
        agreedTeamTotal !== null && agreedTeamTotal > 0
          ? "the crew's agreed"
          : "this job's";
      return {
        success: false,
        error:
          `That would pay the crew $${after.custom.toFixed(2)} — ` +
          `$${after.overshoot.toFixed(2)} more than ${ceiling} ` +
          `$${after.budget.toFixed(2)}. The crew cannot be paid more than the ` +
          `total they come out of — lower another cleaner's amount first, or ` +
          `raise the total on the job itself.`,
      };
    }

    await db.jobAssignment.upsert({
      where: { jobId_cleanerId: { jobId, cleanerId } },
      update: { payAmount: amount },
      create: { jobId, cleanerId, payAmount: amount },
    });

    await db.jobLog.create({
      data: {
        jobId,
        userId: session.user.id,
        action: "UPDATED",
        field: "cleanerPay",
        newValue: amount === null ? "cleared" : String(amount),
        description:
          amount === null
            ? `Cleared the manual pay override for a cleaner (back to the standard split)`
            : `Set a cleaner's pay for this job to $${amount.toFixed(2)}`,
      },
    });

    revalidatePath(`/admin/jobs/${jobId}`);
    return { success: true };
  } catch (e) {
    console.error("setCleanerJobPay", e);
    return { success: false, error: "Could not update the pay" };
  }
}
