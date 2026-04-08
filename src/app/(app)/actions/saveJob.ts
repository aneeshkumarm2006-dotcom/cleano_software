"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { invalidateCalendarDay } from "./invalidateCalendarDay";

export async function saveJob(formData: FormData) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return { error: "Unauthorized" };
  }

  try {
    // Get selected cleaner IDs from form
    const cleanerIds = formData.getAll("cleaners") as string[];

    // Parse all form fields according to schema
    const startDate = formData.get("startDate") as string;
    const startTime = formData.get("startTime") as string;
    const endDate = formData.get("endDate") as string;
    const endTime = formData.get("endTime") as string;

    const jobData: any = {
      employeeId: session.user.id,
      clientName: formData.get("clientName") as string,
      description: (formData.get("description") as string) || null,
      jobType: (formData.get("jobType") as string) || null,
      location: (formData.get("location") as string) || null,
      jobDate: startDate ? new Date(startDate) : null,
      startTime:
        startDate && startTime
          ? new Date(`${startDate}T${startTime}`)
          : new Date(),
      endTime: endDate && endTime ? new Date(`${endDate}T${endTime}`) : null,
      price: formData.get("price")
        ? parseFloat(formData.get("price") as string)
        : null,
      employeePay: formData.get("employeePay")
        ? parseFloat(formData.get("employeePay") as string)
        : null,
      totalTip: formData.get("totalTip")
        ? parseFloat(formData.get("totalTip") as string)
        : null,
      parking: formData.get("parking")
        ? parseFloat(formData.get("parking") as string)
        : null,
      paymentReceived: formData.get("paymentReceived") === "on",
      invoiceSent: formData.get("invoiceSent") === "on",
      notes: (formData.get("notes") as string) || null,
    };

    const editingJobId = formData.get("jobId") as string | null;

    if (editingJobId) {
      // UPDATE existing job
      await db.job.update({
        where: { id: editingJobId },
        data: {
          ...jobData,
          cleaners:
            cleanerIds.length > 0
              ? {
                  set: cleanerIds.map((id) => ({ id })),
                }
              : { set: [] },
        },
      });

      if (jobData.startTime) {
        await invalidateCalendarDay(jobData.startTime.toISOString().slice(0, 10));
      }
      revalidatePath("/jobs");
      revalidatePath(`/jobs/${editingJobId}`);
      return { success: true };
    } else {
      // CREATE new job
      // Only add cleaners if there are any selected
      if (cleanerIds.length > 0) {
        jobData.cleaners = {
          connect: cleanerIds.map((id) => ({ id })),
        };
      }

      const newJob = await db.job.create({
        data: jobData,
      });

      if (jobData.startTime) {
        await invalidateCalendarDay(jobData.startTime.toISOString().slice(0, 10));
      }
      revalidatePath("/jobs");
      return { success: true, jobId: newJob.id };
    }
  } catch (error) {
    console.error("Error saving job:", error);
    return { error: "Failed to save job. Please try again." };
  }
}

