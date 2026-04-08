"use server";

import { db } from "@/db";
import { revalidatePath } from "next/cache";

export async function deleteEmployee(employeeId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
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

    // Delete the employee's account first
    await db.account.deleteMany({
      where: { userId: employeeId },
    });

    // Delete the employee
    await db.user.delete({
      where: { id: employeeId },
    });

    revalidatePath("/employees");
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

