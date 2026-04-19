"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";

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
    let suppliesCost = 0;

    for (const inventory of productInventories) {
      const employeeProduct = employeeProducts.find(
        (ep) => ep.productId === inventory.productId
      );

      if (!employeeProduct) continue;

      const inventoryBefore = employeeProduct.quantity;
      const inventoryAfter = inventory.inventoryAfter;
      const quantityUsed = inventoryBefore - inventoryAfter;

      if (quantityUsed > 0) {
        suppliesCost += quantityUsed * employeeProduct.product.costPerUnit;
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
    const ops: Prisma.PrismaPromise<unknown>[] = [
      db.job.update({
        where: { id: jobId },
        data: {
          clockOutTime: now,
          status: "COMPLETED",
        },
      }),
      db.jobLog.create({
        data: {
          jobId,
          userId: session.user.id,
          action: "CLOCKED_OUT",
          description: `${session.user.name} clocked out`,
        },
      }),
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
    ];

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

    await db.$transaction(ops);

    // Check for low inventory alerts after stock deduction
    for (const inventory of productInventories) {
      const employeeProduct = employeeProducts.find(
        (ep) => ep.productId === inventory.productId
      );
      if (!employeeProduct) continue;

      const product = employeeProduct.product;
      if (inventory.inventoryAfter <= product.minStock && product.minStock > 0) {
        await db.alert.create({
          data: {
            type: "LOW_INVENTORY",
            severity: inventory.inventoryAfter <= 0 ? "CRITICAL" : "WARNING",
            title: `Low stock: ${product.name}`,
            message: `${product.name} for ${session.user.name} is at ${inventory.inventoryAfter} ${product.unit} (min: ${product.minStock})`,
            relatedId: product.id,
            relatedType: "Product",
          },
        });
      }
    }

    revalidatePath("/my-jobs");
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath(`/employees/${session.user.id}`);
    revalidatePath("/finances");
    revalidatePath("/analytics");

    return { success: true };
  } catch (error) {
    console.error("Error clocking out:", error);
    return { success: false, error: "Failed to clock out" };
  }
}

