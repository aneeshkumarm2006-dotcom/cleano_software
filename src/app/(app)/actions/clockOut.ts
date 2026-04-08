"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

interface ProductInventory {
  productId: string;
  inventoryAfter: number;
}

export async function clockOut(
  jobId: string,
  productInventories: ProductInventory[]
) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    // Get the job and verify the user has access
    const job = await db.job.findUnique({
      where: { id: jobId },
      include: {
        employee: true,
        cleaners: true,
        productUsage: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!job) {
      return { success: false, error: "Job not found" };
    }

    // Check if user is assigned to this job
    const isEmployee = job.employeeId === session.user.id;
    const isCleaner = job.cleaners.some(
      (cleaner) => cleaner.id === session.user.id
    );

    if (!isEmployee && !isCleaner) {
      return { success: false, error: "You are not assigned to this job" };
    }

    // Check if clocked in
    if (!job.clockInTime) {
      return { success: false, error: "Not clocked in" };
    }

    // Check if already clocked out
    if (job.clockOutTime) {
      return { success: false, error: "Already clocked out" };
    }

    const now = new Date();

    // Get employee's current product inventory
    const employeeProducts = await db.employeeProduct.findMany({
      where: {
        employeeId: session.user.id,
      },
      include: {
        product: true,
      },
    });

    // Calculate product usage and update inventory
    const productUsageUpdates = [];
    const employeeProductUpdates = [];

    for (const inventory of productInventories) {
      const employeeProduct = employeeProducts.find(
        (ep) => ep.productId === inventory.productId
      );

      if (!employeeProduct) continue;

      const inventoryBefore = employeeProduct.quantity;
      const inventoryAfter = inventory.inventoryAfter;
      const quantityUsed = inventoryBefore - inventoryAfter;

      if (quantityUsed > 0) {
        // Check if product usage already exists
        const existingUsage = job.productUsage.find(
          (pu) => pu.productId === inventory.productId
        );

        if (existingUsage) {
          // Update existing usage
          productUsageUpdates.push(
            db.jobProductUsage.update({
              where: { id: existingUsage.id },
              data: {
                quantity: existingUsage.quantity + quantityUsed,
                inventoryBefore,
                inventoryAfter,
              },
            })
          );
        } else {
          // Create new usage record
          productUsageUpdates.push(
            db.jobProductUsage.create({
              data: {
                jobId,
                productId: inventory.productId,
                quantity: quantityUsed,
                inventoryBefore,
                inventoryAfter,
              },
            })
          );
        }

        // Update employee's product inventory
        employeeProductUpdates.push(
          db.employeeProduct.update({
            where: { id: employeeProduct.id },
            data: {
              quantity: inventoryAfter,
            },
          })
        );

        // Create a log entry for product usage
        await db.jobLog.create({
          data: {
            jobId,
            userId: session.user.id,
            action: "PRODUCT_USED",
            description: `Used ${quantityUsed.toFixed(2)} ${employeeProduct.product.unit} of ${employeeProduct.product.name}`,
          },
        });
      }
    }

    // Execute all updates in a transaction
    await db.$transaction([
      // Update job with clock out time
      db.job.update({
        where: { id: jobId },
        data: {
          clockOutTime: now,
          status: "COMPLETED",
        },
      }),
      // Create clock out log
      db.jobLog.create({
        data: {
          jobId,
          userId: session.user.id,
          action: "CLOCKED_OUT",
          description: `${session.user.name} clocked out`,
        },
      }),
      // Create status change log
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
      }),
      ...productUsageUpdates,
      ...employeeProductUpdates,
    ]);

    revalidatePath("/my-jobs");
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath(`/employees/${session.user.id}`);

    return { success: true };
  } catch (error) {
    console.error("Error clocking out:", error);
    return { success: false, error: "Failed to clock out" };
  }
}

