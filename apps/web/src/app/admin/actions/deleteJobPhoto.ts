"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireOrgId } from "@/lib/org";
import { actorFromSession } from "@/server/actor";
import { fireEffects } from "@/server/effects";
import { deleteJobPhotoFor } from "@/server/photos/photos";

/**
 * Delete a job photo and its Cloudinary asset. The rule lives in
 * server/photos/photos.ts, shared with the phone: an owner or admin may
 * delete any photo; anyone else only their own. `employeeId` is nullable from
 * Stage 11: NULL means the CUSTOMER uploaded it at booking. Nobody on staff
 * "owns" such a photo, and it is the evidence the quote was priced from — so
 * it stays admin-only.
 */
export async function deleteJobPhoto(photoId: string) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const actor = actorFromSession(
      session.user as { id: string; name?: string | null; email: string; role?: string | null },
      await requireOrgId(),
    );
    const result = await deleteJobPhotoFor(actor, { photoId, door: "web" });
    if (!result.ok) return { success: false, error: result.message };

    // The asset is removed after the row, and a failure there is logged and
    // not fatal, as before.
    fireEffects(result.effects);

    revalidatePath(`/cleaners/my-jobs/${result.value.jobId}`);

    return { success: true };
  } catch (error) {
    console.error("Error deleting job photo:", error);
    return { success: false, error: "Failed to delete photo" };
  }
}
