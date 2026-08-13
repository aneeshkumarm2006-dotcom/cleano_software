"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

export async function deleteEmployee(employeeId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    const actorRole = (session?.user as { role?: string } | undefined)?.role;
    if (actorRole !== "OWNER" && actorRole !== "ADMIN") {
      return { success: false, error: "Not authorized." };
    }

    // Check if employee has any jobs
    const employee = await db.user.findUnique({
      where: { id: employeeId },
      include: {
        jobs: true,
      },
    });

    if (!employee) {
      return {
        success: false,
        error: "Employee not found.",
      };
    }

    if (employee.jobs.length > 0) {
      return {
        success: false,
        error: "Cannot delete employee with existing jobs. Please reassign or delete their jobs first.",
      };
    }

    // Commission rows are money owed to this person, so `Commission.salesRepId`
    // is ON DELETE RESTRICT rather than the cascade most User relations use
    // (Stage 11.2). Without this check the delete would fail down in Postgres
    // and surface as the generic "Failed to delete employee", which tells the
    // admin nothing about what is actually holding the record.
    const commissionCount = await db.commission.count({
      where: { salesRepId: employeeId },
    });
    if (commissionCount > 0) {
      return {
        success: false,
        error: `Cannot delete: this person has ${commissionCount} commission record${commissionCount === 1 ? "" : "s"} under Sales → Commissions. Delete those first.`,
      };
    }

    // Delete the employee's account first
    await db.account.deleteMany({
      where: { userId: employeeId },
    });

    // Delete the employee
    await db.user.delete({
      where: { id: employeeId },
    });

    revalidatePath("/admin/employees");
    return {
      success: true,
    };
  } catch (error) {
    console.error("Error deleting employee:", error);
    return {
      success: false,
      error: "Failed to delete employee. Please try again.",
    };
  }
}

