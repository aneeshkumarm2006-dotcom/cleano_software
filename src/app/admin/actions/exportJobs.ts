"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { discountReasonLabel } from "@/lib/discount-reasons";
import type { JobExportRow } from "./exportJobs.types";

interface ExportFilters {
  format: "csv" | "pdf";
  startDate?: string;
  endDate?: string;
  jobType?: string;
  clientId?: string;
  employeeId?: string;
  paymentType?: string;
  status?: string;
  discountedOnly?: boolean;
  unpaidOnly?: boolean;
  /**
   * Archived (soft-deleted) jobs are excluded by default so an export matches
   * the active reporting set (new fix list item 1). Set from the Archived view,
   * where exporting archived history is the explicit intent.
   */
  includeArchived?: boolean;
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function exportJobs(filters: ExportFilters): Promise<
  | {
      success: true;
      format: "csv";
      filename: string;
      content: string;
    }
  | {
      success: true;
      format: "pdf";
      filename: string;
      generatedAt: string;
      rows: JobExportRow[];
    }
  | { error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const role = (session.user as any).role;
  const isAdmin = role === "OWNER" || role === "ADMIN";

  const where: any = {};
  // Active-only unless the caller explicitly asked for the archive.
  where.deletedAt = filters.includeArchived ? { not: null } : null;
  if (!isAdmin) where.employeeId = session.user.id;

  if (filters.startDate || filters.endDate) {
    where.startTime = {};
    if (filters.startDate) where.startTime.gte = new Date(filters.startDate);
    if (filters.endDate) where.startTime.lte = new Date(filters.endDate);
  }
  if (filters.jobType && filters.jobType !== "all")
    where.jobType = filters.jobType;
  if (filters.clientId && filters.clientId !== "all")
    where.clientId = filters.clientId;
  if (filters.employeeId && filters.employeeId !== "all")
    where.employeeId = filters.employeeId;
  if (filters.paymentType && filters.paymentType !== "all")
    where.paymentType = filters.paymentType;
  if (filters.status && filters.status !== "all") where.status = filters.status;
  if (filters.discountedOnly) where.discountAmount = { gt: 0 };
  if (filters.unpaidOnly) {
    where.paymentReceived = false;
    where.status = "COMPLETED";
  }

  try {
    const jobs = await db.job.findMany({
      where,
      orderBy: { startTime: "desc" },
      include: {
        employee: { select: { name: true } },
        client: { select: { name: true } },
      },
    });

    const rows = jobs.map((j) => ({
      Date: j.jobDate
        ? j.jobDate.toISOString().slice(0, 10)
        : j.startTime.toISOString().slice(0, 10),
      Client: j.client?.name || j.clientName,
      Employee: j.employee?.name || "",
      Location: j.location || "",
      "Job Type": j.jobType || "",
      Status: j.status,
      Price: j.price ?? "",
      Discount: j.discountAmount ?? "",
      // Item 29: the reason travels with the discount into reporting, so a
      // discounted-jobs export can be grouped by why.
      "Discount Reason": discountReasonLabel(j) ?? "",
      "Employee Pay": j.employeePay ?? "",
      Tip: j.totalTip ?? "",
      Parking: j.parking ?? "",
      "Payment Type": j.paymentType || "",
      "Payment Received": j.paymentReceived ? "Yes" : "No",
      "Invoice Sent": j.invoiceSent ? "Yes" : "No",
      Bed: j.bedCount ?? "",
      Bath: j.bathCount ?? "",
    }));

    const headerKeys = Object.keys(
      rows[0] || {
        Date: "",
        Client: "",
        Employee: "",
        Location: "",
        "Job Type": "",
        Status: "",
        Price: "",
        Discount: "",
        "Discount Reason": "",
        "Employee Pay": "",
        Tip: "",
        Parking: "",
        "Payment Type": "",
        "Payment Received": "",
        "Invoice Sent": "",
        Bed: "",
        Bath: "",
      }
    );

    const timestamp = new Date().toISOString().slice(0, 10);

    if (filters.format === "csv") {
      const lines: string[] = [];
      lines.push(headerKeys.map(csvEscape).join(","));
      for (const row of rows) {
        lines.push(
          headerKeys
            .map((k) => csvEscape((row as Record<string, unknown>)[k]))
            .join(",")
        );
      }
      return {
        success: true,
        format: "csv",
        filename: `jobs-export-${timestamp}.csv`,
        content: lines.join("\n"),
      };
    }

    return {
      success: true,
      format: "pdf",
      filename: `jobs-export-${timestamp}.pdf`,
      generatedAt: timestamp,
      rows: rows as JobExportRow[],
    };
  } catch (error) {
    console.error("exportJobs error:", error);
    return { error: "Failed to export jobs" };
  }
}
