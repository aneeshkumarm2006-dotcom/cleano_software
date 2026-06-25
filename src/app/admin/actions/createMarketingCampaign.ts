"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";

export async function createMarketingCampaign(formData: FormData) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const role = (session.user as any).role;
  if (role !== "ADMIN" && role !== "OWNER") {
    return { error: "Forbidden" };
  }

  const name = (formData.get("name") as string)?.trim();
  if (!name) return { error: "Campaign name is required" };

  try {
    const campaign = await db.marketingCampaign.create({
      data: {
        name,
        description: (formData.get("description") as string) || null,
        status: (formData.get("status") as any) || "DRAFT",
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
    return { success: true, campaignId: campaign.id };
  } catch (error) {
    console.error("Error creating marketing campaign:", error);
    return { error: "Failed to create campaign" };
  }
}
