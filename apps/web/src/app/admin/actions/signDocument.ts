"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { cloudinary } from "@/lib/cloudinary";
import type { UploadApiResponse } from "cloudinary";
import { sendAdminDocSigned } from "@/lib/email";
import { orgAssetFolder } from "@/lib/asset-folder";

interface SignDocumentInput {
  documentId: string;
  signatureDataUrl: string;
}

function uploadDataUrl(
  dataUrl: string,
  folder: string,
  publicId: string
): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      dataUrl,
      {
        folder,
        public_id: publicId,
        resource_type: "image",
        overwrite: false,
      },
      (error, result) => {
        if (error || !result) {
          reject(error || new Error("Upload failed"));
        } else {
          resolve(result);
        }
      }
    );
  });
}

export async function signDocument(input: SignDocumentInput) {
  try {
    const hdrs = await headers();
    const session = await auth.api.getSession({ headers: hdrs });
    if (!session) return { success: false, error: "Not authenticated" };

    const { documentId, signatureDataUrl } = input;
    if (!documentId) {
      return { success: false, error: "Document id is required" };
    }
    if (!signatureDataUrl?.startsWith("data:image")) {
      return { success: false, error: "A signature is required" };
    }

    const employeeId = session.user.id;

    const signatureRow = await db.documentSignature.findUnique({
      where: { documentId_employeeId: { documentId, employeeId } },
    });
    if (!signatureRow) {
      return {
        success: false,
        error: "This document is not assigned to you",
      };
    }
    if (signatureRow.status === "SIGNED") {
      return { success: false, error: "Document already signed" };
    }
    if (signatureRow.status === "REVOKED") {
      return { success: false, error: "Document has been revoked" };
    }

    let signatureUrl: string | null = null;
    if (
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
    ) {
      try {
        const folder = await orgAssetFolder("signatures", documentId);
        const publicId = `${employeeId}-${Date.now()}`;
        const result = await uploadDataUrl(signatureDataUrl, folder, publicId);
        signatureUrl = result.secure_url;
      } catch (err) {
        console.error("Signature upload failed:", err);
        return { success: false, error: "Failed to store signature image" };
      }
    } else {
      signatureUrl = signatureDataUrl;
    }

    const ipAddress =
      hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      hdrs.get("x-real-ip") ||
      null;

    const updated = await db.documentSignature.update({
      where: { documentId_employeeId: { documentId, employeeId } },
      data: {
        status: "SIGNED",
        signatureUrl,
        signedAt: new Date(),
        ipAddress,
      },
    });

    // Item 20: signing = completing the document, into the access log.
    await db.documentAccessLog
      .create({ data: { documentId, userId: employeeId, action: "COMPLETE" } })
      .catch((e) => console.error("document access log", e));

    revalidatePath("/admin/documents");
    revalidatePath(`/admin/documents/${documentId}`);
    revalidatePath("/admin/settings");

    // Admin notification — gated by `admin.docs.signed_completed`.
    const doc = await db.document.findUnique({
      where: { id: documentId },
      select: { title: true },
    });
    sendAdminDocSigned({
      signerName: session.user.name ?? "Cleaner",
      documentTitle: doc?.title ?? "Document",
    }).catch((e) => console.error("admin doc-signed", e));

    return { success: true, signature: updated };
  } catch (error) {
    console.error("Error signing document:", error);
    return { success: false, error: "Failed to sign document" };
  }
}
