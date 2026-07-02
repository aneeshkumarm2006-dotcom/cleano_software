"use server";

import { db } from "@/db";
import { cloudinary } from "@/lib/cloudinary";
import type { UploadApiResponse } from "cloudinary";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_PHOTOS_PER_JOB = 5;
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
];

function streamUpload(
  buffer: Buffer,
  folder: string,
  publicId: string
): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
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
    stream.end(buffer);
  });
}

/**
 * Public (unauthenticated) upload of a client review photo.
 *
 * Authorization is carried by the rating token, not a session: the caller must
 * present a valid, unused, unexpired {@link JobRatingToken}. That token is the
 * same secret the "rate your cleaning" email link contains, so only the
 * customer who received the receipt can upload. We upload to Cloudinary here
 * and return the URL; the ReviewPhoto row itself is written by submitRating
 * once the customer actually submits the rating.
 */
export async function uploadReviewPhoto(
  formData: FormData
): Promise<{ success: true; url: string } | { success: false; error: string }> {
  const token = formData.get("token");
  const file = formData.get("file");

  if (typeof token !== "string" || !token) {
    return { success: false, error: "Missing rating token" };
  }
  if (!file || typeof file === "string") {
    return { success: false, error: "No file provided" };
  }
  if (file.size === 0) {
    return { success: false, error: "Empty file" };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { success: false, error: "File exceeds 10MB limit" };
  }
  if (!ALLOWED_TYPES.includes(file.type.toLowerCase())) {
    return {
      success: false,
      error: "Unsupported file type. Use JPG, PNG, HEIC, or WebP.",
    };
  }

  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    return { success: false, error: "Cloudinary is not configured on the server" };
  }

  try {
    // Validate the rating token — this is what authorizes an anonymous upload.
    const tokenRow = await db.jobRatingToken.findUnique({
      where: { token },
      select: { jobId: true, usedAt: true, expiresAt: true },
    });

    if (!tokenRow) {
      return { success: false, error: "Invalid rating link" };
    }
    if (tokenRow.usedAt) {
      return { success: false, error: "This rating link has already been used" };
    }
    if (tokenRow.expiresAt && tokenRow.expiresAt < new Date()) {
      return { success: false, error: "This rating link has expired" };
    }

    const existingCount = await db.reviewPhoto.count({
      where: { jobId: tokenRow.jobId },
    });
    if (existingCount >= MAX_PHOTOS_PER_JOB) {
      return {
        success: false,
        error: `Maximum of ${MAX_PHOTOS_PER_JOB} photos reached`,
      };
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const folder = `cleano/reviews/${tokenRow.jobId}`;
    const publicId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const result = await streamUpload(buffer, folder, publicId);

    return { success: true, url: result.secure_url };
  } catch (error) {
    console.error("Error uploading review photo:", error);
    return { success: false, error: "Failed to upload photo" };
  }
}
