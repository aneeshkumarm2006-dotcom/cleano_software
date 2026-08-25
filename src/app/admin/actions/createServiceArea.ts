"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

interface CreateServiceAreaInput {
  prefix: string;
  zoneName: string;
  travelFee?: number;
  notes?: string | null;
  isActive?: boolean;
}

export async function createServiceArea(input: CreateServiceAreaInput) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }

    const prefix = input.prefix?.trim().toUpperCase();
    if (!prefix) return { success: false, error: "Postal prefix is required" };
    if (!/^[A-Z][0-9][A-Z]?$/.test(prefix)) {
      return {
        success: false,
        error: "Prefix must be Canadian-style (e.g. H1, H1A)",
      };
    }
    if (!input.zoneName?.trim()) {
      return { success: false, error: "Zone name is required" };
    }

    const existing = await db.serviceArea.findUnique({ where: { prefix } });
    if (existing) {
      return { success: false, error: `Prefix ${prefix} already exists` };
    }

    const area = await db.serviceArea.create({
      data: {
        prefix,
        zoneName: input.zoneName.trim(),
        travelFee: input.travelFee ?? 0,
        notes: input.notes?.trim() || null,
        isActive: input.isActive ?? true,
      },
    });

    revalidatePath("/admin/settings");
    return { success: true, serviceAreaId: area.id };
  } catch (error) {
    console.error("Error creating service area:", error);
    return { success: false, error: "Failed to create service area" };
  }
}
