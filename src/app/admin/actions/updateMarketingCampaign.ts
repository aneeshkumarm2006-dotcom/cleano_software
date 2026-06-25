"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";

export async function updateMarketingCampaign(
  id: string,
  formData: FormData
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const role = (session.user as any).role;
  if (role !== "ADMIN" && role !== "OWNER") {
    return { error: "Forbidden" };
  }

  const name = (formData.get("name") as string)?.trim();
  if (!name) return { error: "Campaign name is required" };

  try {
    await db.marketingCampaign.update({
      where: { id },
      data: {
        name,
        description: (formData.get("description") as string) || null,
        status: (formData.get("status") as any) || undefined,
        budget: parseFloat(formData.get("budget") as string) || 0,
        spent: parseFloat(formData.get("spent") as string) || 0,
        startDate: formData.get("startDate")
          ? new Date(formData.get("startDate") as string)
          : null,
        endDate: formData.get("endDate")
          ? new Date(formData.get("endDate") as string)
          : null,
        channel: (formData.get("channel") as string) || null,
        notes: (formData.get("notes") as string) || null,
      },
    });

    revalidatePath("/admin/sales");
    return { success: true };
  } catch (error) {
    console.error("Error updating marketing campaign:", error);
    return { error: "Failed to update campaign" };
  }
}

export async function deleteMarketingCampaign(id: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const role = (session.user as any).role;
  if (role !== "ADMIN" && role !== "OWNER") {
    return { error: "Forbidden" };
  }

  try {
    await db.marketingCampaign.delete({ where: { id } });
    revalidatePath("/admin/sales");
    return { success: true };
  } catch (error) {
    console.error("Error deleting marketing campaign:", error);
    return { error: "Failed to delete campaign" };
  }
}
