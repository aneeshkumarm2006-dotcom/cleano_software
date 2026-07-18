"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { projectWashables, CREDIT_PER_RAG, CREDIT_PER_PAD } from "@/lib/wash";
import { sendAdminClockedOut } from "@/lib/email";
import { ensureRatingRequest } from "@/lib/rating";

const ML_PER_SPRAY = 1.25;

export interface PostJobUsage {
  sprays: Array<{ productId: string; sprayCount: number }>;
  mops: Array<{ productId: string; mopCount: number }>;
  disposables: Array<{ productId: string; quantity: number }>;
  // Fallback for products with category "OTHER" — legacy remaining-quantity input.
  remaining: Array<{ productId: string; inventoryAfter: number }>;
}

interface RestockItem {
  name: string;
  productId: string;
}

export async function clockOut(jobId: string, usage: PostJobUsage) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };

  try {
    const job = await db.job.findUnique({
      where: { id: jobId },
      include: {
        employee: true,
        cleaners: true,
        productUsage: { include: { product: true } },
        addOns: true,
      },
    });

    if (!job) return { success: false, error: "Job not found" };

    const isEmployee = job.employeeId === session.user.id;
    const isCleaner = job.cleaners.some((c) => c.id === session.user.id);
    if (!isEmployee && !isCleaner) {
      return { success: false, error: "You are not assigned to this job" };
    }
    if (!job.clockInTime) return { success: false, error: "Not clocked in" };
    if (job.clockOutTime) return { success: false, error: "Already clocked out" };

    const now = new Date();

    const employeeProducts = await db.employeeProduct.findMany({
      where: { employeeId: session.user.id },
      include: { product: { include: { inventoryRule: true } } },
    });
    const epByProductId = new Map(employeeProducts.map((ep) => [ep.productId, ep]));

    // Compute deductions per product.
    const deductions = new Map<string, number>();

    for (const s of usage.sprays) {
      if (s.sprayCount > 0) {
        deductions.set(s.productId, (deductions.get(s.productId) ?? 0) + s.sprayCount * ML_PER_SPRAY);
      }
    }
    for (const m of usage.mops) {
      if (m.mopCount > 0) {
        deductions.set(m.productId, (deductions.get(m.productId) ?? 0) + m.mopCount);
      }
    }
    for (const d of usage.disposables) {
      if (d.quantity > 0) {
        deductions.set(d.productId, (deductions.get(d.productId) ?? 0) + d.quantity);
      }
    }
    // "OTHER" remaining-style inputs — convert to a "used" deduction.
    for (const r of usage.remaining) {
      const ep = epByProductId.get(r.productId);
      if (!ep) continue;
      const used = ep.quantity - r.inventoryAfter;
      if (used > 0) {
        deductions.set(r.productId, (deductions.get(r.productId) ?? 0) + used);
      }
    }

    const ops: Prisma.PrismaPromise<unknown>[] = [];
    let suppliesCost = 0;
    const restockNeeded: RestockItem[] = [];

    for (const [productId, used] of deductions.entries()) {
      const ep = epByProductId.get(productId);
      if (!ep) continue;

      const inventoryBefore = ep.quantity;
      const inventoryAfter = Math.max(0, inventoryBefore - used);
      const actualUsed = inventoryBefore - inventoryAfter;
      suppliesCost += actualUsed * ep.product.costPerUnit;

      // Upsert per-job usage record (merge if a partial pre-existed).
      const existingUsage = job.productUsage.find((pu) => pu.productId === productId);
      if (existingUsage) {
        ops.push(
          db.jobProductUsage.update({
            where: { id: existingUsage.id },
            data: {
              quantity: existingUsage.quantity + actualUsed,
              inventoryBefore,
              inventoryAfter,
            },
          })
        );
      } else {
        ops.push(
          db.jobProductUsage.create({
            data: {
              jobId,
              productId,
              quantity: actualUsed,
              inventoryBefore,
              inventoryAfter,
            },
          })
        );
      }

      // Deduct from employee stock.
      ops.push(
        db.employeeProduct.update({
          where: { id: ep.id },
          data: { quantity: inventoryAfter },
        })
      );

      // Job log.
      ops.push(
        db.jobLog.create({
          data: {
            jobId,
            userId: session.user.id,
            action: "PRODUCT_USED",
            description: `Used ${actualUsed.toFixed(2)} ${ep.product.unit} of ${ep.product.name}`,
          },
        })
      );

      // Threshold check — per the spec, restock alert fires when stock <= threshold.
      const threshold = ep.product.inventoryRule?.refillThreshold ?? ep.product.minStock ?? 0;
      if (threshold > 0 && inventoryAfter <= threshold) {
        restockNeeded.push({ name: ep.product.name, productId });
      }
    }

    // Rag-wash projection per the Self-Wash spec. Capped credits are awarded
    // once per job (washCreditsAwarded flag) and divided across assigned
    // cleaners so two cleaners on one job split the rag/pad pool fairly.
    const projection = projectWashables({
      bedCount: job.bedCount,
      bathCount: job.bathCount,
      jobType: job.jobType,
      addOnNames: job.addOns.map((a) => a.name),
    });

    const cleanerIdsForCredit = (() => {
      const ids = new Set<string>();
      if (job.employeeId) ids.add(job.employeeId);
      for (const c of job.cleaners) ids.add(c.id);
      return Array.from(ids);
    })();

    // Close the job + write projection fields.
    ops.push(
      db.job.update({
        where: { id: jobId },
        data: {
          clockOutTime: now,
          // Paid stays Paid — clock-out must never downgrade a job whose
          // payment was already received.
          status:
            job.status === "PAID" || job.paymentReceived ? "PAID" : "COMPLETED",
          washProjectedRags: projection.projectedRags,
          washProjectedPads: projection.projectedPads,
          washCappedRags: projection.cappedRags,
          washCappedPads: projection.cappedPads,
          // Note: actuals aren't reported at clock-out; cleaner logs them via
          // /my-inventory/rag-wash. We mark the *award* as done so we don't
          // double-credit on repeated clock-outs.
          washCreditsAwarded: !job.washCreditsAwarded && cleanerIdsForCredit.length > 0
            ? true
            : job.washCreditsAwarded,
        },
      })
    );

    // Per-cleaner assignment status (item 9) — upsert so legacy jobs without
    // rows still start tracking from this clock-out.
    ops.push(
      db.jobAssignment.upsert({
        where: {
          jobId_cleanerId: { jobId, cleanerId: session.user.id },
        },
        update: { status: "CLOCKED_OUT", clockOutTime: now },
        create: {
          jobId,
          cleanerId: session.user.id,
          status: "CLOCKED_OUT",
          clockOutTime: now,
        },
      })
    );

    // Award rag + pad credits to each assigned cleaner, idempotent on the
    // washCreditsAwarded flag.
    if (!job.washCreditsAwarded && cleanerIdsForCredit.length > 0) {
      const ragShare = Math.floor(
        (projection.cappedRags * CREDIT_PER_RAG) / cleanerIdsForCredit.length
      );
      const padShare = Math.floor(
        (projection.cappedPads * CREDIT_PER_PAD) / cleanerIdsForCredit.length
      );
      if (ragShare > 0 || padShare > 0) {
        for (const cleanerId of cleanerIdsForCredit) {
          ops.push(
            db.user.update({
              where: { id: cleanerId },
              data: {
                ragCredits: { increment: ragShare },
                padCredits: { increment: padShare },
              },
            })
          );
        }
      }
    }

    ops.push(
      db.jobLog.create({
        data: {
          jobId,
          userId: session.user.id,
          action: "CLOCKED_OUT",
          description: `${session.user.name} clocked out`,
        },
      })
    );
    ops.push(
      db.jobLog.create({
        data: {
          jobId,
          userId: session.user.id,
          action: "STATUS_CHANGED",
          field: "status",
          oldValue: job.status,
          newValue: "COMPLETED",
          description: `Status changed from ${job.status} to COMPLETED`,
        },
      })
    );

    if (suppliesCost > 0) {
      ops.push(
        db.transaction.create({
          data: {
            date: now,
            category: "SUPPLIES",
            amount: suppliesCost,
            description: `Supplies consumed for ${job.clientName}`,
            jobId,
            source: "AUTO_CLOCK_OUT",
            isAuto: true,
          },
        })
      );
    }

    // Per spec: one combined cleaner-facing restock alert when ≥1 item is low.
    if (restockNeeded.length > 0) {
      const names = restockNeeded.map((r) => r.name);
      const list =
        names.length === 1
          ? names[0]
          : names.length === 2
          ? `${names[0]} and ${names[1]}`
          : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
      const message =
        names.length === 1
          ? `You are low on ${list}. Please refill it from the storage locker before your next job.`
          : `You are low on ${list}. Please refill these items from the storage locker before your next job.`;

      ops.push(
        db.alert.create({
          data: {
            type: "PROVIDER_LOW_STOCK",
            severity: "WARNING",
            title: "Restock needed before your next job",
            message,
            recipientUserId: session.user.id,
            relatedId: jobId,
            relatedType: "Job",
          },
        })
      );
    }

    await db.$transaction(ops);

    // Admin email — gated by `admin.clock.clocked_out`.
    const clockInTime = job.clockInTime ? new Date(job.clockInTime) : null;
    const durationMinutes = clockInTime
      ? Math.max(1, Math.round((now.getTime() - clockInTime.getTime()) / 60000))
      : 0;
    sendAdminClockedOut({
      jobId,
      jobNumber: job.jobNumber,
      clientName: job.clientName,
      cleanerName: session.user.name ?? "Cleaner",
      durationMinutes,
    }).catch((e) => console.error("admin clocked-out email", e));

    // The cleaner just finished the job — ask the customer to rate it.
    await ensureRatingRequest(jobId).catch((e) =>
      console.error("ensureRatingRequest", e)
    );

    revalidatePath("/cleaners/my-jobs");
    revalidatePath(`/cleaners/my-jobs/${jobId}`);
    revalidatePath(`/admin/jobs/${jobId}`);
    revalidatePath(`/admin/employees/${session.user.id}`);
    revalidatePath("/admin/finances");
    revalidatePath("/admin/analytics");
    revalidatePath("/cleaners/my-inventory");

    return { success: true, restockNeeded: restockNeeded.length > 0 };
  } catch (error) {
    console.error("Error clocking out:", error);
    return { success: false, error: "Failed to clock out" };
  }
}
