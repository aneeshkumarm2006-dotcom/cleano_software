"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { cloudinary } from "@/lib/cloudinary";

function extractCloudinaryPublicId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("res.cloudinary.com")) return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const uploadIdx = parts.indexOf("upload");
    if (uploadIdx === -1) return null;
    let after = parts.slice(uploadIdx + 1);
    if (after[0] && /^v\d+$/.test(after[0])) after = after.slice(1);
    if (after.length === 0) return null;
    const last = after[after.length - 1].replace(/\.[^.]+$/, "");
    after[after.length - 1] = last;
    return after.join("/");
  } catch {
    return null;
  }
}

export async function deleteJobPhoto(photoId: string) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const photo = await db.jobPhoto.findUnique({
      where: { id: photoId },
    });

    if (!photo) {
      return { success: false, error: "Photo not found" };
    }

    const role = (session.user as { role?: string }).role;
    const isAdmin = role === "OWNER" || role === "ADMIN";
    // `employeeId` is nullable from Stage 11: NULL means the CUSTOMER uploaded it
    // at booking. Nobody on staff "owns" such a photo, and it is the evidence the
    // quote was priced from — so this stays admin-only. The comparison already
    // yields false for NULL; the `!!` makes that intentional rather than incidental.
    const isOwner = !!photo.employeeId && photo.employeeId === session.user.id;

    if (!isAdmin && !isOwner) {
      return {
        success: false,
        error: "You can only delete your own photos",
      };
    }

    const publicId = extractCloudinaryPublicId(photo.url);
    if (
      publicId &&
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
    ) {
      try {
        await cloudinary.uploader.destroy(publicId, {
          resource_type: "image",
          invalidate: true,
        });
      } catch (err) {
        console.error("Failed to remove Cloudinary asset (continuing):", err);
      }
    }

    await db.jobPhoto.delete({ where: { id: photoId } });

    revalidatePath(`/cleaners/my-jobs/${photo.jobId}`);

    return { success: true };
  } catch (error) {
    console.error("Error deleting job photo:", error);
    return { success: false, error: "Failed to delete photo" };
  }
}
