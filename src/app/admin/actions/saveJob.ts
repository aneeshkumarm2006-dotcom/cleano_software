"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { invalidateCalendarDay } from "./invalidateCalendarDay";
import {
  sendAdminBookingModified,
  sendAdminBookingCanceled,
  sendCustomerBookingConfirmed,
  sendCustomerBookingModified,
  sendCustomerBookingCancellation,
  sendAdminTipReceived,
  sendCustomerFeesCharged,
  sendAdminUnassignedEvent,
  sendProviderNewTip,
  sendProviderBookingCanceled,
} from "@/lib/email";
import { isNotificationEnabled } from "@/lib/notifications";
import { smsBookingConfirmation, smsCancellation } from "@/lib/sms";
import { getCleanerRateInputs } from "@/lib/cleaner-rates";
import { computeJobPayout } from "@/lib/pay-tiers";
import { createAssignmentInvites } from "@/lib/invites";
import { getSetting } from "@/lib/settings";
import {
  recurringDiscountPercent,
  recurrenceCount,
  nextOccurrence,
} from "@/lib/booking-pricing";

const RECURRING_FREQUENCIES = ["WEEKLY", "BIWEEKLY"] as const;
type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

const VALID_PAYMENT_TYPES = [
  "CASH",
  "CHEQUE",
  "E_TRANSFER",
  "CREDIT_CARD",
  "OTHER",
] as const;

function parseOptionalFloat(value: FormDataEntryValue | null): number | null {
  if (value === null || value === "") return null;
  const n = parseFloat(value as string);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalInt(value: FormDataEntryValue | null): number | null {
  if (value === null || value === "") return null;
  const n = parseInt(value as string, 10);
  return Number.isFinite(n) ? n : null;
}

export async function saveJob(formData: FormData) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return { error: "Unauthorized" };
  }

  try {
    const cleanerIds = formData.getAll("cleaners") as string[];
    const frequencyRaw = (formData.get("frequency") as string) || "ONE_TIME";
    const recurringFrequency = RECURRING_FREQUENCIES.includes(
      frequencyRaw as RecurringFrequency
    )
      ? (frequencyRaw as RecurringFrequency)
      : null;
    const addOnsRaw = formData.get("addOns") as string | null;
    let addOns: Array<{ name: string; price: number }> = [];
    if (addOnsRaw) {
      try {
        const parsed = JSON.parse(addOnsRaw);
        if (Array.isArray(parsed)) {
          addOns = parsed
            .filter((a) => a && typeof a.name === "string" && a.name.trim())
            .map((a) => ({
              name: String(a.name).trim(),
              price: Number(a.price) || 0,
            }));
        }
      } catch {
        // ignore bad JSON
      }
    }

    const startDate = formData.get("startDate") as string;
    const startTime = formData.get("startTime") as string;
    const endDate = formData.get("endDate") as string;
    const endTime = formData.get("endTime") as string;

    const paymentTypeRaw = (formData.get("paymentType") as string) || "";
    const paymentType = VALID_PAYMENT_TYPES.includes(paymentTypeRaw as any)
      ? (paymentTypeRaw as (typeof VALID_PAYMENT_TYPES)[number])
      : null;

    const clientId = (formData.get("clientId") as string) || null;
    let clientName = (formData.get("clientName") as string) || "";
    let clientDiscountPercent = 0;

    if (clientId) {
      const existing = await db.client.findUnique({ where: { id: clientId } });
      if (existing) {
        if (!clientName) clientName = existing.name;
        clientDiscountPercent = existing.discountPercent || 0;
      }
    }

    const price = parseOptionalFloat(formData.get("price"));
    let discountAmount = parseOptionalFloat(formData.get("discountAmount"));

    // Auto-apply client default discount when admin hasn't entered one.
    // Treat null/empty as "not entered"; admin can pass "0" to opt out.
    if (
      discountAmount === null &&
      clientDiscountPercent > 0 &&
      price !== null &&
      price > 0
    ) {
      discountAmount = +(price * (clientDiscountPercent / 100)).toFixed(2);
    }

    // Auto-estimate cleaner pay from the tier-based pool when admin leaves the
    // field blank. Manual entry still wins (acts as an override). Authoritative
    // per-cleaner payout is recomputed from tiers at pay-period time.
    const manualEmployeePay = parseOptionalFloat(formData.get("employeePay"));
    let estimatedEmployeePay = manualEmployeePay;
    if (manualEmployeePay === null && price !== null && price > 0 && cleanerIds.length > 0) {
      const rateInputs = await getCleanerRateInputs([
        session.user.id,
        ...cleanerIds,
      ]);
      const rateList = [session.user.id, ...cleanerIds].map(
        (id) =>
          rateInputs.get(id) ?? {
            id,
            tier: "STANDARD" as const,
            avgRating: null,
            ratingCount: 0,
          }
      );
      estimatedEmployeePay = computeJobPayout(price, rateList).pool;
    }

    const jobData: any = {
      employeeId: session.user.id,
      clientName,
      clientId,
      description: (formData.get("description") as string) || null,
      jobType: (formData.get("jobType") as string) || null,
      location: (formData.get("location") as string) || null,
      aptNumber: (formData.get("aptNumber") as string) || null,
      jobDate: startDate ? new Date(startDate) : null,
      startTime:
        startDate && startTime
          ? new Date(`${startDate}T${startTime}`)
          : new Date(),
      endTime: endDate && endTime ? new Date(`${endDate}T${endTime}`) : null,
      price,
      employeePay: estimatedEmployeePay,
      totalTip: parseOptionalFloat(formData.get("totalTip")),
      parking: parseOptionalFloat(formData.get("parking")),
      paymentReceived: formData.get("paymentReceived") === "on",
      invoiceSent: formData.get("invoiceSent") === "on",
      notes: (formData.get("notes") as string) || null,
      paymentType,
      discountAmount,
      bedCount: parseOptionalInt(formData.get("bedCount")),
      bathCount: parseOptionalInt(formData.get("bathCount")),
      halfBathCount: parseOptionalInt(formData.get("halfBathCount")),
      payRateMultiplier:
        parseOptionalFloat(formData.get("payRateMultiplier")) ?? 1.0,
    };

    const editingJobId = formData.get("jobId") as string | null;
    const statusRaw = (formData.get("status") as string) || null;

    if (editingJobId) {
      // Snapshot the existing job so we can detect transitions:
      //  - status → CANCELLED (sends customer + admin cancellation)
      //  - 0 cleaners → ≥1 (sends customer "confirmed" email)
      //  - any other change (sends "modified" notifications)
      const existingJob = await db.job.findUnique({
        where: { id: editingJobId },
        select: {
          status: true,
          clientName: true,
          jobNumber: true,
          startTime: true,
          location: true,
          jobType: true,
          totalTip: true,
          client: { select: { email: true, name: true, phone: true } },
          cleaners: { select: { id: true, name: true, email: true } },
        },
      });

      const updateData: any = {
        ...jobData,
        cleaners:
          cleanerIds.length > 0
            ? { set: cleanerIds.map((id) => ({ id })) }
            : { set: [] },
        addOns: {
          deleteMany: {},
          create: addOns.map((a) => ({ name: a.name, price: a.price })),
        },
      };

      if (statusRaw) {
        updateData.status = statusRaw;
      }

      await db.job.update({
        where: { id: editingJobId },
        data: updateData,
      });

      // ── Booking lifecycle notifications ──────────────────────────
      const sessionUserName = session.user.name ?? "Admin";
      const lifecycleInfo = existingJob
        ? {
            jobId: editingJobId,
            jobNumber: existingJob.jobNumber,
            clientName: existingJob.clientName,
            startTime: existingJob.startTime.toISOString(),
            address: existingJob.location ?? "",
            serviceType: existingJob.jobType,
          }
        : null;

      // Case A — job just got CANCELLED
      if (
        statusRaw === "CANCELLED" &&
        existingJob &&
        existingJob.status !== "CANCELLED"
      ) {
        // System alert (legacy)
        await db.alert.create({
          data: {
            type: "CANCELLATION",
            severity: "WARNING",
            title: `Job cancelled: ${existingJob.clientName}`,
            message: `Job for ${existingJob.clientName} was cancelled (previously ${existingJob.status})`,
            relatedId: editingJobId,
            relatedType: "Job",
          },
        });

        // Admin email (after-5pm variant chosen inside the helper)
        if (lifecycleInfo) {
          sendAdminBookingCanceled({
            ...lifecycleInfo,
            canceledBy: sessionUserName,
          }).catch((e) => console.error("admin cancel email", e));

          // Customer email
          if (existingJob.client?.email) {
            sendCustomerBookingCancellation({
              ...lifecycleInfo,
              to: existingJob.client.email,
            }).catch((e) => console.error("customer cancel email", e));
          }
          // Customer SMS (gated by Twilio config + catalog toggle).
          if (existingJob.client?.phone) {
            smsCancellation({
              to: existingJob.client.phone,
              jobNumber: existingJob.jobNumber,
            }).catch((e) => console.error("customer cancel sms", e));
          }

          // Notify each assigned cleaner — email + app-push alert.
          for (const c of existingJob.cleaners) {
            if (c.email) {
              sendProviderBookingCanceled({
                to: c.email,
                providerName: c.name,
                jobId: editingJobId,
                jobNumber: existingJob.jobNumber,
                clientName: existingJob.clientName,
                startTime: existingJob.startTime.toISOString(),
                address: existingJob.location ?? "",
                serviceType: existingJob.jobType,
              }).catch((e) => console.error("provider cancel email", e));
            }
            if (await isNotificationEnabled("PROVIDER", "prov.cancel.booking_canceled", "APP_PUSH")) {
              await db.alert.create({
                data: {
                  type: "CANCELLATION",
                  severity: "WARNING",
                  title: `Booking canceled — ${existingJob.clientName}`,
                  message: `Job #${existingJob.jobNumber} on ${existingJob.startTime.toLocaleDateString()} was canceled.`,
                  recipientUserId: c.id,
                  relatedId: editingJobId,
                  relatedType: "Job",
                },
              }).catch(() => {});
            }
          }
        }
      } else if (existingJob && lifecycleInfo) {
        // Case B — non-cancel edit. Detect "cleaners just got assigned"
        // (customer "Booking confirmed") + generic "Booking modified".
        const previousCleanerIds = new Set(existingJob.cleaners.map((c) => c.id));
        const cleanersAdded = cleanerIds.filter((id) => !previousCleanerIds.has(id));
        const justGotFirstCleaner =
          existingJob.cleaners.length === 0 && cleanerIds.length > 0;

        // Customer "Booking confirmed" when the first cleaner is paired.
        if (justGotFirstCleaner && existingJob.client?.email) {
          const assignedCleaners = await db.user.findMany({
            where: { id: { in: cleanerIds } },
            select: { name: true },
          });
          sendCustomerBookingConfirmed({
            ...lifecycleInfo,
            to: existingJob.client.email,
            cleanerNames: assignedCleaners.map((c) => c.name),
          }).catch((e) => console.error("customer confirmed email", e));
          // Customer SMS (gated by Twilio config + catalog toggle).
          if (existingJob.client?.phone) {
            smsBookingConfirmation({
              to: existingJob.client.phone,
              jobNumber: existingJob.jobNumber,
              startTime: existingJob.startTime.toISOString(),
            }).catch((e) => console.error("customer confirmed sms", e));
          }
        }

        // Admin + customer "Booking modified" on any other edit.
        if (!justGotFirstCleaner) {
          sendAdminBookingModified({
            ...lifecycleInfo,
            changedBy: sessionUserName,
          }).catch((e) => console.error("admin modified email", e));
          if (existingJob.client?.email) {
            sendCustomerBookingModified({
              ...lifecycleInfo,
              to: existingJob.client.email,
            }).catch((e) => console.error("customer modified email", e));
          }
        }

        // Accept/decline invite for newly assigned cleaners.
        if (cleanersAdded.length > 0) {
          await createAssignmentInvites({
            jobId: editingJobId,
            cleanerIds: cleanersAdded,
          });
        }

        // Provider app-push for newly assigned cleaners ("New booking" for them).
        for (const cleanerId of cleanersAdded) {
          if (await isNotificationEnabled("PROVIDER", "prov.booking.new", "APP_PUSH")) {
            await db.alert.create({
              data: {
                type: "GENERAL",
                severity: "INFO",
                title: `New booking — ${existingJob.clientName}`,
                message: `Job #${existingJob.jobNumber} on ${existingJob.startTime.toLocaleDateString()} at ${existingJob.startTime.toLocaleTimeString()} has been assigned to you.`,
                recipientUserId: cleanerId,
                relatedId: editingJobId,
                relatedType: "Job",
              },
            }).catch(() => {});
          }
        }

        // Provider app-push for cleaners on a modified (already assigned) job.
        const stillAssigned = cleanerIds.filter((id) => previousCleanerIds.has(id));
        if (!justGotFirstCleaner && stillAssigned.length > 0) {
          const after5 = (() => {
            const dayBefore = new Date(existingJob.startTime);
            dayBefore.setDate(dayBefore.getDate() - 1);
            dayBefore.setHours(17, 0, 0, 0);
            return new Date() >= dayBefore && new Date() < existingJob.startTime;
          })();
          const provKey = after5 ? "prov.booking.modified_after_5pm" : "prov.booking.modified";
          for (const cleanerId of stillAssigned) {
            if (await isNotificationEnabled("PROVIDER", provKey, "APP_PUSH")) {
              await db.alert.create({
                data: {
                  type: "GENERAL",
                  severity: after5 ? "WARNING" : "INFO",
                  title: `Booking updated — ${existingJob.clientName}`,
                  message: `Job #${existingJob.jobNumber} on ${existingJob.startTime.toLocaleDateString()} was modified${after5 ? " after 5 pm" : ""}.`,
                  recipientUserId: cleanerId,
                  relatedId: editingJobId,
                  relatedType: "Job",
                },
              }).catch(() => {});
            }
          }
        }
      }

      // Unassigned-folder events. The PDF treats "unassigned" as a booking
      // without any cleaners assigned yet (or fewer than required). Detect
      // transitions and fire the right catalog row.
      if (existingJob && lifecycleInfo) {
        const previouslyUnassigned = existingJob.cleaners.length === 0;
        const nowUnassigned = cleanerIds.length === 0;
        const openStatus =
          statusRaw !== "CANCELLED" &&
          statusRaw !== "COMPLETED" &&
          statusRaw !== "PAID";

        if (openStatus) {
          if (!previouslyUnassigned && nowUnassigned) {
            // Cleaners just got removed → "moved to unassigned"
            sendAdminUnassignedEvent({
              event: "moved",
              ...lifecycleInfo,
            }).catch((e) => console.error("admin unassigned moved", e));
          } else if (previouslyUnassigned && !nowUnassigned) {
            // Someone grabbed it
            sendAdminUnassignedEvent({
              event: "grabbed",
              ...lifecycleInfo,
            }).catch((e) => console.error("admin unassigned grabbed", e));
          } else if (previouslyUnassigned && nowUnassigned) {
            // Was unassigned, still unassigned, but the booking was edited
            sendAdminUnassignedEvent({
              event: "modified",
              ...lifecycleInfo,
            }).catch((e) => console.error("admin unassigned modified", e));
          }
        }
      }

      // Tip detection — admin gets `admin.fee.tip_received`, customer gets
      // `cust.fee.fees_charged` (only when totalTip increased).
      if (existingJob && lifecycleInfo) {
        const oldTip = existingJob.totalTip ?? 0;
        const newTip = jobData.totalTip ?? 0;
        if (newTip > oldTip && newTip - oldTip > 0.001) {
          const tipDelta = newTip - oldTip;
          sendAdminTipReceived({
            ...lifecycleInfo,
            tipAmount: tipDelta,
            cleanerNames: existingJob.cleaners.map((c) => c.name),
          }).catch((e) => console.error("admin tip-received email", e));
          if (existingJob.client?.email) {
            sendCustomerFeesCharged({
              ...lifecycleInfo,
              to: existingJob.client.email,
              clientName: existingJob.clientName,
              feeType: "tip",
              amount: tipDelta,
            }).catch((e) => console.error("customer tip-fee email", e));
          }
          // Tell every assigned cleaner about their tip — split evenly.
          if (existingJob.cleaners.length > 0) {
            const perCleaner = tipDelta / existingJob.cleaners.length;
            const cleanerUsers = await db.user.findMany({
              where: { id: { in: existingJob.cleaners.map((c) => c.id) } },
              select: { name: true, email: true },
            });
            for (const c of cleanerUsers) {
              if (!c.email) continue;
              sendProviderNewTip({
                to: c.email,
                providerName: c.name,
                jobId: editingJobId,
                jobNumber: existingJob.jobNumber,
                tipAmount: perCleaner,
                clientName: existingJob.clientName,
              }).catch((e) => console.error("provider tip email", e));
            }
          }
        }
      }

      if (jobData.startTime) {
        await invalidateCalendarDay(
          jobData.startTime.toISOString().slice(0, 10)
        );
      }
      revalidatePath("/admin/jobs");
      revalidatePath(`/admin/jobs/${editingJobId}`);
      revalidatePath("/admin/analytics");
      return { success: true };
    } else {
      if (cleanerIds.length > 0) {
        jobData.cleaners = {
          connect: cleanerIds.map((id) => ({ id })),
        };
      }
      if (addOns.length > 0) {
        jobData.addOns = {
          create: addOns.map((a) => ({ name: a.name, price: a.price })),
        };
      }

      const newJob = await db.job.create({ data: jobData });

      // Accept/decline invite for any cleaners assigned at creation.
      if (cleanerIds.length > 0) {
        await createAssignmentInvites({
          jobId: newJob.id,
          cleanerIds,
        });
      }

      // ── Recurring series ─────────────────────────────────────────────
      // Weekly/biweekly bookings auto-create the next few occurrences. The
      // first cleaning (this job) stays full price; subsequent cleanings get
      // the recurring discount (WEEKLY 12% / BIWEEKLY 8%) recorded on
      // discountAmount. Same assigned team carries across occurrences.
      if (recurringFrequency && jobData.startTime) {
        const weeklyHorizon = await getSetting(
          "scheduling.recurringWeeklyHorizon"
        );
        const occurrences = recurrenceCount(recurringFrequency, weeklyHorizon);
        const basePrice = jobData.price ?? 0;
        const discountPct = recurringDiscountPercent(recurringFrequency);
        const recurringDiscount =
          basePrice > 0 && discountPct > 0
            ? Math.round(((basePrice * discountPct) / 100) * 100) / 100
            : 0;
        const childDiscount =
          recurringDiscount > 0
            ? +((jobData.discountAmount ?? 0) + recurringDiscount).toFixed(2)
            : jobData.discountAmount;

        // Preserve the job's duration across occurrences.
        const durationMs =
          jobData.endTime instanceof Date
            ? jobData.endTime.getTime() - jobData.startTime.getTime()
            : null;

        let cursor: Date = jobData.startTime;
        for (let i = 0; i < occurrences; i++) {
          cursor = nextOccurrence(cursor, recurringFrequency);
          const childData: any = {
            ...jobData,
            jobDate: cursor,
            startTime: cursor,
            endTime: durationMs != null ? new Date(cursor.getTime() + durationMs) : null,
            discountAmount: childDiscount,
            bookingSource: "admin-recurring",
            parentJob: { connect: { id: newJob.id } },
          };
          if (cleanerIds.length > 0) {
            childData.cleaners = { connect: cleanerIds.map((id) => ({ id })) };
          }
          if (addOns.length > 0) {
            childData.addOns = {
              create: addOns.map((a) => ({ name: a.name, price: a.price })),
            };
          }

          const child = await db.job.create({ data: childData });

          if (cleanerIds.length > 0) {
            await createAssignmentInvites({ jobId: child.id, cleanerIds });
          }
          await invalidateCalendarDay(cursor.toISOString().slice(0, 10));
        }
      }

      // If created with no cleaners, this lands in the unassigned folder.
      if (cleanerIds.length === 0 && jobData.startTime) {
        sendAdminUnassignedEvent({
          event: "new",
          jobId: newJob.id,
          jobNumber: newJob.jobNumber,
          clientName: newJob.clientName,
          startTime: jobData.startTime.toISOString(),
        }).catch((e) => console.error("admin unassigned new", e));
      }

      if (jobData.startTime) {
        await invalidateCalendarDay(
          jobData.startTime.toISOString().slice(0, 10)
        );
      }
      revalidatePath("/admin/jobs");
      revalidatePath("/admin/analytics");
      return { success: true, jobId: newJob.id };
    }
  } catch (error) {
    console.error("Error saving job:", error);
    return { error: "Failed to save job. Please try again." };
  }
}
