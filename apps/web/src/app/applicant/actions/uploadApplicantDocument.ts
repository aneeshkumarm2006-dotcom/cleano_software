"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { cloudinary } from "@/lib/cloudinary";
import type { UploadApiResponse } from "cloudinary";
import {
  APPLICANT_DOCUMENT_KIND,
  resourceTypeFor,
  validateApplicantDocument,
} from "@/lib/employee-files";
import { isApplicantRole } from "@/lib/role-routing";
import { orgAssetFolder } from "@/lib/asset-folder";

/**
 * An invited applicant uploads a supporting document (decision D4). Same
 * private-Cloudinary / EmployeeFile plumbing as uploadVoidCheque.ts — a
 * distinct `kind` keeps applicant uploads and payroll files from ever mixing,
 * and (unlike the void cheque, which is "replace the current one") this
 * table is meant to accumulate: an applicant may have several documents.
 *
 * SELF-SCOPED: the applicant id comes from the session and is never read
 * from the caller.
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
        // Same private-delivery mode as the void cheque — view/download stays
        // behind the OWNER/ADMIN signed-URL action (getEmployeeFileUrl.ts).
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

export async function uploadApplicantDocument(formData: FormData): Promise<
  { success: true } | { success: false; error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (!isApplicantRole(role)) return { success: false, error: "Not authorized" };
  const applicantId = session.user.id;

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return { success: false, error: "No file provided" };
  }

  const invalid = validateApplicantDocument({ size: file.size, type: file.type });
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
    const fileName = (file.name || "document").slice(0, 120);
    const publicId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const folder = await orgAssetFolder("applicant-documents", applicantId);

    const result = await streamUpload(buffer, folder, publicId, resourceType);

    await db.employeeFile.create({
      data: {
        employeeId: applicantId,
        kind: APPLICANT_DOCUMENT_KIND,
        fileUrl: result.secure_url,
        publicId: result.public_id,
        resourceType,
        fileName,
        mimeType,
      },
    });

    revalidatePath("/applicant");
    revalidatePath("/admin/job-applications");
    return { success: true };
  } catch (error) {
    console.error("Error uploading applicant document:", error);
    return { success: false, error: "Failed to upload file" };
  }
}
