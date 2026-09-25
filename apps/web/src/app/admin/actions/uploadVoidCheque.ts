"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { cloudinary } from "@/lib/cloudinary";
import type { UploadApiResponse } from "cloudinary";
import {
  VOID_CHEQUE_KIND,
  resourceTypeFor,
  validateVoidCheque,
} from "@/lib/employee-files";
import { orgAssetFolder } from "@/lib/asset-folder";

/**
 * A cleaner uploads their own void cheque / direct deposit info
 * (awerfixes.pdf item 16). Follows the shape of `uploadResume`, with two
 * deliberate departures:
 *
 *   1. `type: "authenticated"` (decision 7). Every other upload in this repo
 *      lands on a public URL that anyone with the link can fetch forever. This
 *      one is refused without a signature, and only `getEmployeeFileUrl` —
 *      OWNER/ADMIN, logged — can mint one.
 *   2. The row is APPENDED, never updated. Replacing a cheque leaves the old
 *      row in place so a change of banking details is visible, not silent.
 *
 * SELF-SCOPED: the employee id comes from the session and is never read from
 * the caller. There is no parameter an attacker could point at someone else.
 */
function streamUpload(
  buffer: Buffer,
  folder: string,
  publicId: string,
  resourceType: "image" | "raw"
): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: resourceType,
        // The whole point: a private asset, not a public one.
        type: "authenticated",
        overwrite: false,
        timeout: 90_000,
      },
      (error, result) => {
        if (error || !result) reject(error || new Error("Upload failed"));
        else resolve(result);
      }
    );
    stream.end(buffer);
  });
}

export async function uploadVoidCheque(formData: FormData): Promise<
  { success: true } | { success: false; error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  const employeeId = session.user.id;

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return { success: false, error: "No file provided" };
  }

  // Same rule the browser applied before sending — see src/lib/employee-files.ts.
  const invalid = validateVoidCheque({ size: file.size, type: file.type });
  if (invalid) return { success: false, error: invalid };

  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    return { success: false, error: "Uploads are not configured on the server" };
  }

  try {
    const mimeType = file.type.trim().toLowerCase();
    const resourceType = resourceTypeFor(mimeType);
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = (file.name || "void-cheque").slice(0, 120);
    const publicId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const folder = await orgAssetFolder("void-cheques", employeeId);

    const result = await streamUpload(buffer, folder, publicId, resourceType);

    await db.employeeFile.create({
      data: {
        employeeId,
        kind: VOID_CHEQUE_KIND,
        // Stored for completeness and for a future migration off Cloudinary.
        // On its own it is not access: fetching it unsigned is denied.
        fileUrl: result.secure_url,
        // What signing actually needs. Never re-derived from the URL — an
        // authenticated delivery path has no `/upload/` segment for
        // deleteJobPhoto's parser to find.
        publicId: result.public_id,
        resourceType,
        fileName,
        mimeType,
      },
    });

    revalidatePath("/cleaners/documents");
    revalidatePath("/admin/documents");
    revalidatePath(`/admin/employees/${employeeId}`);
    return { success: true };
  } catch (error) {
    console.error("Error uploading void cheque:", error);
    return { success: false, error: "Failed to upload file" };
  }
}
