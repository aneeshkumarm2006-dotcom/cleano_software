"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import type {
  MissingEquipmentItem,
  EquipmentCheckResult,
} from "./checkEquipmentForJob.types";

export async function checkEquipmentForJob(
  jobId: string,
  employeeIdOverride?: string
): Promise<
  | { success: true; result: EquipmentCheckResult }
  | { success: false; error: string }
> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const job = await db.job.findUnique({
      where: { id: jobId },
      include: {
        addOns: true,
        cleaners: { select: { id: true } },
      },
    });

    if (!job) {
      return { success: false, error: "Job not found" };
    }

    const role = (session.user as { role?: string }).role;
    const isAdmin = role === "OWNER" || role === "ADMIN";
    const employeeId = employeeIdOverride || session.user.id;

    const isAssigned =
      job.employeeId === employeeId ||
      job.cleaners.some((c) => c.id === employeeId);

    if (!isAdmin && !isAssigned) {
      return { success: false, error: "Not authorized to view this job" };
    }

    const employeeProducts = await db.employeeProduct.findMany({
      where: { employeeId },
      include: { product: true },
    });

    const employeeInventory = new Map<
      string,
      { quantity: number; name: string; unit: string }
    >();
    for (const ep of employeeProducts) {
      employeeInventory.set(ep.productId, {
        quantity: ep.quantity,
        name: ep.product.name,
        unit: ep.product.unit,
      });
    }

    const requiredMap = new Map<
      string,
      { needed: number; product: { name: string; unit: string }; source: MissingEquipmentItem["source"] }
    >();

    if (job.jobType) {
      const kitTemplates = await db.kitTemplate.findMany({
        where: {
          isActive: true,
          name: { equals: job.jobType, mode: "insensitive" },
        },
        include: { items: { include: { product: true } } },
      });

      for (const kit of kitTemplates) {
        for (const item of kit.items) {
          const existing = requiredMap.get(item.productId);
          if (existing) {
            existing.needed += item.quantity;
          } else {
            requiredMap.set(item.productId, {
              needed: item.quantity,
              product: { name: item.product.name, unit: item.product.unit },
              source: "JOB_TYPE_KIT",
            });
          }
        }
      }
    }

    if (job.addOns.length > 0) {
      const addOnNames = job.addOns.map((a) => a.name);
      const addOnKits = await db.kitTemplate.findMany({
        where: {
          isActive: true,
          name: { in: addOnNames, mode: "insensitive" },
        },
        include: { items: { include: { product: true } } },
      });
      for (const kit of addOnKits) {
        for (const item of kit.items) {
          const existing = requiredMap.get(item.productId);
          if (existing) {
            existing.needed += item.quantity;
          } else {
            requiredMap.set(item.productId, {
              needed: item.quantity,
              product: { name: item.product.name, unit: item.product.unit },
              source: "ADD_ON",
            });
          }
        }
      }
    }

    if (requiredMap.size === 0) {
      const inventoryRules = await db.inventoryRule.findMany({
        where: { usagePerJob: { gt: 0 } },
        include: { product: true },
      });
      for (const rule of inventoryRules) {
        requiredMap.set(rule.productId, {
          needed: rule.usagePerJob,
          product: { name: rule.product.name, unit: rule.product.unit },
          source: "USAGE_RULE",
        });
      }
    }

    const missing: MissingEquipmentItem[] = [];
    for (const [productId, req] of requiredMap.entries()) {
      const have = employeeInventory.get(productId)?.quantity ?? 0;
      if (have < req.needed) {
        missing.push({
          productId,
          productName: req.product.name,
          unit: req.product.unit,
          needed: req.needed,
          have,
          shortBy: req.needed - have,
          source: req.source,
        });
      }
    }

    return {
      success: true,
      result: {
        jobId: job.id,
        clientName: job.clientName,
        jobDate: job.jobDate,
        jobType: job.jobType,
        addOns: job.addOns.map((a) => a.name),
        missing,
      },
    };
  } catch (error) {
    console.error("Error checking equipment for job:", error);
    return { success: false, error: "Failed to check equipment" };
  }
}
