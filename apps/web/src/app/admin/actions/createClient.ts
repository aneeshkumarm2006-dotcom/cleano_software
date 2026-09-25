"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/org-db";
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

  // Customer-specific fixed pricing ("Change Total"). Empty clears it.
  const fixedPriceRaw = formData.get("fixedPrice") as string | null;
  let fixedPrice: number | null = null;
  if (fixedPriceRaw !== null && fixedPriceRaw !== "") {
    const n = parseFloat(fixedPriceRaw);
    if (!Number.isFinite(n) || n < 0) {
      return { error: "Fixed price must be a positive amount" };
    }
    fixedPrice = n > 0 ? n : null;
  }
  const fixedPriceRecurring =
    fixedPrice !== null && formData.get("fixedPriceRecurring") === "true";
  const fixedPriceAllowFrequencyDiscount =
    fixedPriceRecurring &&
    formData.get("fixedPriceAllowFrequencyDiscount") === "true";

  try {
    const client = await db.client.create({
      data: {
        name,
        email: (formData.get("email") as string) || null,
        secondaryEmail: (formData.get("secondaryEmail") as string) || null,
        phone: (formData.get("phone") as string) || null,
        secondaryPhone: (formData.get("secondaryPhone") as string) || null,
        company: (formData.get("company") as string) || null,
        address: (formData.get("address") as string) || null,
        aptNumber: (formData.get("aptNumber") as string) || null,
        city: (formData.get("city") as string) || null,
        state: (formData.get("state") as string) || null,
        zip: (formData.get("zip") as string) || null,
        notes: (formData.get("notes") as string) || null,
        discountPercent,
        fixedPrice,
        fixedPriceRecurring,
        fixedPriceAllowFrequencyDiscount,
      },
    });

    revalidatePath("/admin/clients");
    return { success: true, clientId: client.id };
  } catch (error) {
    console.error("Error creating client:", error);
    return { error: "Failed to create client" };
  }
}
