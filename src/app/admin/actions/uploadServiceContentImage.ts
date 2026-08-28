"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { cloudinary } from "@/lib/cloudinary";
import type { UploadApiResponse } from "cloudinary";
import { orgAssetFolder } from "@/lib/asset-folder";

// Uploads a single "What's included" graphic (item 3) to Cloudinary and returns
// its URL. Admin-only; the URL is then stored in the `content.serviceIncluded`
// AppSetting by the settings tab. Mirrors uploadJobPhoto's streamUpload.

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
  "image/gif",
];

function streamUpload(
  buffer: Buffer,
  folder: string,
  publicId: string
): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, public_id: publicId, resource_type: "image", overwrite: false, timeout: 90_000 },
      (error, result) => {
        if (error || !result) reject(error || new Error("Upload failed"));
        else resolve(result);
      }
    );
    stream.end(buffer);
  });
}

export async function uploadServiceContentImage(
  formData: FormData
): Promise<{ success: true; url: string } | { success: false; error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };

  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { success: false, error: "Not authorized" };
  }

  const file = formData.get("file") as File | null;
  if (!file || typeof file === "string") return { success: false, error: "No file provided" };
  if (file.size === 0) return { success: false, error: "Empty file" };
  if (file.size > MAX_FILE_SIZE) return { success: false, error: "File exceeds 10MB limit" };
  if (!ALLOWED_TYPES.includes(file.type.toLowerCase())) {
    return { success: false, error: "Unsupported file type. Use JPG, PNG, GIF, HEIC, or WebP." };
  }

  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    return { success: false, error: "Cloudinary is not configured on the server" };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const publicId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await streamUpload(buffer, await orgAssetFolder("service-content"), publicId);
    return { success: true, url: result.secure_url };
  } catch (error) {
    console.error("Error uploading service-content image:", error);
    return { success: false, error: "Failed to upload image" };
  }
}
