"use server";

import { db } from "@/db";
import type { AlertType, AlertSeverity } from "@prisma/client";

interface CreateAlertInput {
  type: AlertType;
  severity?: AlertSeverity;
  title: string;
  message: string;
  relatedId?: string;
  relatedType?: string;
}

export async function createAlert(input: CreateAlertInput) {
  try {
    const alert = await db.alert.create({
      data: {
        type: input.type,
        severity: input.severity ?? "WARNING",
        title: input.title,
        message: input.message,
        relatedId: input.relatedId ?? null,
        relatedType: input.relatedType ?? null,
      },
    });
    return { success: true, alert };
  } catch (error) {
    console.error("Error creating alert:", error);
    return { success: false, error: "Failed to create alert" };
  }
}

export async function dismissAlert(alertId: string) {
  try {
    await db.alert.update({
      where: { id: alertId },
      data: { isDismissed: true },
    });
    return { success: true };
  } catch (error) {
    console.error("Error dismissing alert:", error);
    return { success: false, error: "Failed to dismiss alert" };
  }
}

export async function markAlertRead(alertId: string) {
  try {
    await db.alert.update({
      where: { id: alertId },
      data: { isRead: true },
    });
    return { success: true };
  } catch (error) {
    console.error("Error marking alert as read:", error);
    return { success: false, error: "Failed to mark alert as read" };
  }
}
