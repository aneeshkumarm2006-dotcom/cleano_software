"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/org-db";
import { revalidatePath } from "next/cache";

export async function createLandingPage(formData: FormData) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const role = (session.user as any).role;
  if (role !== "ADMIN" && role !== "OWNER") {
    return { error: "Forbidden" };
  }

  const title = (formData.get("title") as string)?.trim();
  if (!title) return { error: "Title is required" };

  const slug = (formData.get("slug") as string)?.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (!slug) return { error: "Slug is required" };

  const content = (formData.get("content") as string)?.trim();
  if (!content) return { error: "Content is required" };

  try {
    const existing = await db.landingPage.findFirst({ where: { slug } });
    if (existing) return { error: "A page with this slug already exists" };

    const page = await db.landingPage.create({
      data: {
        title,
        slug,
        content,
        ctaText: (formData.get("ctaText") as string) || "Get a Free Quote",
        ctaLink: (formData.get("ctaLink") as string) || "/",
        isPublished: formData.get("isPublished") === "true",
        campaignId: (formData.get("campaignId") as string) || null,
      },
    });

    revalidatePath("/admin/sales");
    return { success: true, pageId: page.id };
  } catch (error) {
    console.error("Error creating landing page:", error);
    return { error: "Failed to create landing page" };
  }
}

export async function updateLandingPage(id: string, formData: FormData) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const role = (session.user as any).role;
  if (role !== "ADMIN" && role !== "OWNER") {
    return { error: "Forbidden" };
  }

  const title = (formData.get("title") as string)?.trim();
  if (!title) return { error: "Title is required" };

  try {
    await db.landingPage.update({
      where: { id },
      data: {
        title,
        content: (formData.get("content") as string) || undefined,
        ctaText: (formData.get("ctaText") as string) || undefined,
        ctaLink: (formData.get("ctaLink") as string) || undefined,
        isPublished: formData.get("isPublished") === "true",
        campaignId: (formData.get("campaignId") as string) || null,
      },
    });

    revalidatePath("/admin/sales");
    return { success: true };
  } catch (error) {
    console.error("Error updating landing page:", error);
    return { error: "Failed to update landing page" };
  }
}

export async function deleteLandingPage(id: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const role = (session.user as any).role;
  if (role !== "ADMIN" && role !== "OWNER") {
    return { error: "Forbidden" };
  }

  try {
    await db.landingPage.delete({ where: { id } });
    revalidatePath("/admin/sales");
    return { success: true };
  } catch (error) {
    console.error("Error deleting landing page:", error);
    return { error: "Failed to delete landing page" };
  }
}
