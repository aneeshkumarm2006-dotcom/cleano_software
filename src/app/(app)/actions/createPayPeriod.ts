"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";

export async function createPayPeriod(formData: FormData) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const role = (session.user as any).role;
  if (role !== "ADMIN" && role !== "OWNER") {
    return { error: "Forbidden" };
  }

  const startDateStr = formData.get("startDate") as string;
  const endDateStr = formData.get("endDate") as string;
  const notes = (formData.get("notes") as string) || null;

  if (!startDateStr || !endDateStr) {
    return { error: "Start and end dates are required" };
  }

  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return { error: "Invalid dates" };
  }

  if (endDate < startDate) {
    return { error: "End date must be on or after start date" };
  }

  const rangeEnd = new Date(endDate);
  rangeEnd.setHours(23, 59, 59, 999);

  try {
    const employees = await db.user.findMany({
      where: { role: { in: ["EMPLOYEE", "ADMIN", "OWNER"] } },
      select: { id: true, payMultiplier: true },
    });

    const jobs = await db.job.findMany({
      where: {
        status: { in: ["COMPLETED", "PAID"] },
        OR: [
          { jobDate: { gte: startDate, lte: rangeEnd } },
          {
            AND: [
              { jobDate: null },
              { startTime: { gte: startDate, lte: rangeEnd } },
            ],
          },
        ],
      },
      select: {
        id: true,
        employeeId: true,
        employeePay: true,
        totalTip: true,
        payRateMultiplier: true,
        clockInTime: true,
        clockOutTime: true,
        startTime: true,
        endTime: true,
        cleaners: { select: { id: true } },
      },
    });

    const payoutMap = new Map<
      string,
      { base: number; jobCount: number; hours: number }
    >();
    for (const emp of employees) {
      payoutMap.set(emp.id, { base: 0, jobCount: 0, hours: 0 });
    }

    for (const job of jobs) {
      const cleanerIds = job.cleaners.map((c) => c.id);
      const participantIds = Array.from(
        new Set([job.employeeId, ...cleanerIds])
      );
      if (participantIds.length === 0) continue;

      const basePay = (job.employeePay || 0) + (job.totalTip || 0);
      const multiplier = job.payRateMultiplier ?? 1;
      const jobPay = basePay * multiplier;
      const perPerson = jobPay / participantIds.length;

      const start = job.clockInTime ?? job.startTime;
      const end = job.clockOutTime ?? job.endTime;
      let hours = 0;
      if (start && end) {
        hours = Math.max(
          0,
          (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000
        );
      }
      const perPersonHours = hours / participantIds.length;

      for (const pid of participantIds) {
        if (!payoutMap.has(pid)) {
          payoutMap.set(pid, { base: 0, jobCount: 0, hours: 0 });
        }
        const entry = payoutMap.get(pid)!;
        const empMultiplier =
          employees.find((e) => e.id === pid)?.payMultiplier ?? 1;
        entry.base += perPerson * empMultiplier;
        entry.jobCount += 1;
        entry.hours += perPersonHours;
      }
    }

    const payPeriod = await db.payPeriod.create({
      data: {
        startDate,
        endDate,
        notes,
        status: "DRAFT",
        payouts: {
          create: Array.from(payoutMap.entries())
            .filter(([, v]) => v.jobCount > 0 || v.base > 0)
            .map(([employeeId, v]) => ({
              employeeId,
              baseAmount: Number(v.base.toFixed(2)),
              finalAmount: Number(v.base.toFixed(2)),
              jobCount: v.jobCount,
              totalHours: Number(v.hours.toFixed(2)),
            })),
        },
      },
    });

    revalidatePath("/payouts");
    return { success: true, payPeriodId: payPeriod.id };
  } catch (error) {
    console.error("Error creating pay period:", error);
    return { error: "Failed to create pay period" };
  }
}
