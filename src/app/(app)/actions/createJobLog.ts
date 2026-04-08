"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

interface CreateJobLogParams {
  jobId: string;
  action:
    | "CREATED"
    | "UPDATED"
    | "CLOCKED_IN"
    | "CLOCKED_OUT"
    | "STATUS_CHANGED"
    | "PAYMENT_RECEIVED"
    | "INVOICE_SENT"
    | "PRODUCT_USED"
    | "NOTE_ADDED"
    | "CLEANER_ADDED"
    | "CLEANER_REMOVED";
  field?: string;
  oldValue?: string;
  newValue?: string;
  description: string;
}

export async function createJobLog(params: CreateJobLogParams) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    await db.jobLog.create({
      data: {
        jobId: params.jobId,
        userId: session.user.id,
        action: params.action,
        field: params.field,
        oldValue: params.oldValue,
        newValue: params.newValue,
        description: params.description,
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Error creating job log:", error);
    return { success: false, error: "Failed to create log entry" };
  }
}

