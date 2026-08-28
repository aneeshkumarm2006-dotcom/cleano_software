"use server";

import { cloudinary } from "@/lib/cloudinary";
import type { UploadApiResponse } from "cloudinary";
import { orgAssetFolder } from "@/lib/asset-folder";

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB
const ALLOWED_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

// The folder is passed in rather than resolved here: this returns a Promise but
// is not itself async, and the company has to be looked up before the stream is
// opened.
function streamUpload(
  buffer: Buffer,
  publicId: string,
  folder: string
): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, public_id: publicId, resource_type: "raw", overwrite: false },
      (error, result) => {
        if (error || !result) reject(error || new Error("Upload failed"));
        else resolve(result);
      }
    );
    stream.end(buffer);
  });
}

/** Public resume upload for the careers form. Returns the hosted file URL. */
export async function uploadResume(formData: FormData) {
  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return { success: false, error: "No file provided" };
  }
  if (file.size === 0) return { success: false, error: "Empty file" };
  if (file.size > MAX_FILE_SIZE) {
    return { success: false, error: "File exceeds 8MB limit" };
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { success: false, error: "Use a PDF or Word document" };
  }
  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    return { success: false, error: "Uploads are not configured on the server" };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60);
    const publicId = `${Date.now()}-${safeName}`;
    const result = await streamUpload(buffer, publicId, await orgAssetFolder("resumes"));
    return { success: true, url: result.secure_url };
  } catch (error) {
    console.error("Error uploading resume:", error);
    return { success: false, error: "Failed to upload resume" };
  }
}
