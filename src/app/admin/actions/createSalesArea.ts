"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";

export async function createSalesArea(formData: FormData) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const role = (session.user as any).role;
  if (role !== "ADMIN" && role !== "OWNER") {
    return { error: "Forbidden" };
  }

  const name = (formData.get("name") as string)?.trim();
  if (!name) return { error: "Name is required" };

  const type = formData.get("type") as string;
  if (!type) return { error: "Type is required" };

  const latitude = parseFloat(formData.get("latitude") as string);
  const longitude = parseFloat(formData.get("longitude") as string);
  if (isNaN(latitude) || isNaN(longitude)) {
    return { error: "Valid coordinates are required" };
  }

  try {
    const salesArea = await db.salesArea.create({
      data: {
        name,
        type: type as any,
        latitude,
        longitude,
        address: (formData.get("address") as string) || null,
        notes: (formData.get("notes") as string) || null,
        date: formData.get("date")
          ? new Date(formData.get("date") as string)
          : new Date(),
      },
    });

    revalidatePath("/admin/sales");
    return { success: true, salesAreaId: salesArea.id };
  } catch (error) {
    console.error("Error creating sales area:", error);
    return { error: "Failed to create sales area" };
  }
}
