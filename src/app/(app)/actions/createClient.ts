"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";

export async function createClient(formData: FormData) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const role = (session.user as any).role;
  if (role !== "ADMIN" && role !== "OWNER") {
    return { error: "Forbidden" };
  }

  const name = (formData.get("name") as string)?.trim();
  if (!name) return { error: "Client name is required" };

  const discountRaw = formData.get("discountPercent") as string | null;
  let discountPercent = 0;
  if (discountRaw !== null && discountRaw !== "") {
    const n = parseFloat(discountRaw);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return { error: "Discount percent must be between 0 and 100" };
    }
    discountPercent = n;
  }

  try {
    const client = await db.client.create({
      data: {
        name,
        email: (formData.get("email") as string) || null,
        secondaryEmail: (formData.get("secondaryEmail") as string) || null,
        phone: (formData.get("phone") as string) || null,
        secondaryPhone: (formData.get("secondaryPhone") as string) || null,
        address: (formData.get("address") as string) || null,
        notes: (formData.get("notes") as string) || null,
        discountPercent,
      },
    });

    revalidatePath("/clients");
    return { success: true, clientId: client.id };
  } catch (error) {
    console.error("Error creating client:", error);
    return { error: "Failed to create client" };
  }
}
