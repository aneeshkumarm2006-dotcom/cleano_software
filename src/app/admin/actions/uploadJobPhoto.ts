"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { cloudinary } from "@/lib/cloudinary";
import {
  afterPhotosAllowed,
  jobPhotoKindLabel,
  MAX_PHOTOS_PER_JOB,
  parseJobPhotoKind,
} from "@/lib/job-photos";
import type { UploadApiResponse } from "cloudinary";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
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
        // Give slow phone uploads room; without this the default is short and a
        // large HEIC on a cell connection silently fails.
        timeout: 90_000,
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

export async function uploadJobPhoto(formData: FormData) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  const jobId = formData.get("jobId") as string | null;
  const file = formData.get("file") as File | null;
  const captionRaw = formData.get("caption");
  const caption =
    typeof captionRaw === "string" && captionRaw.trim().length > 0
      ? captionRaw.trim()
      : null;
  // What this photo documents (item 1). Never rejected for being absent or
  // unrecognised — `parseJobPhotoKind` folds both to GENERAL, because an upload
  // must not fail over its filing. The photo is the evidence; the label is
  // metadata an admin can correct afterwards.
  const kind = parseJobPhotoKind(formData.get("kind"));

  if (!jobId) {
    return { success: false, error: "Missing job ID" };
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
    return {
      success: false,
      error: "Cloudinary is not configured on the server",
    };
  }

  try {
    const job = await db.job.findUnique({
      where: { id: jobId },
      include: {
        cleaners: { select: { id: true } },
      },
    });

    if (!job) {
      return { success: false, error: "Job not found" };
    }

    const role = (session.user as { role?: string }).role;
    const isAdmin = role === "OWNER" || role === "ADMIN";
    const isEmployee = job.employeeId === session.user.id;
    const isCleaner = job.cleaners.some((c) => c.id === session.user.id);

    if (!isAdmin && !isEmployee && !isCleaner) {
      return { success: false, error: "Not authorized for this job" };
    }

    // After-photos are allowed by default (item 21); this gate only fires
    // when an admin explicitly disabled them for this job. Admins bypass.
    if (!isAdmin && !afterPhotosAllowed(job)) {
      return {
        success: false,
        error:
          "After-photos are turned off for this job. Ask an admin to enable them before uploading.",
      };
    }

    // The cap is now `MAX_PHOTOS_PER_JOB` (200), up from a hardcoded 20 that
    // lived in two files at once — see src/lib/job-photos.ts for why a ceiling
    // still exists at all. The widget prints the same number before a cleaner
    // picks a file, so reaching this branch should mean a genuinely enormous
    // job, not a surprise.
    const existingCount = await db.jobPhoto.count({ where: { jobId } });
    if (existingCount >= MAX_PHOTOS_PER_JOB) {
      return {
        success: false,
        error: `This job already has ${existingCount} photos (${MAX_PHOTOS_PER_JOB} is the maximum). Ask an admin before adding more.`,
      };
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const folder = `cleano/jobs/${jobId}`;
    const publicId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const result = await streamUpload(buffer, folder, publicId);

    const photo = await db.jobPhoto.create({
      data: {
        jobId,
        employeeId: session.user.id,
        url: result.secure_url,
        caption,
        kind,
      },
    });

    revalidatePath(`/cleaners/my-jobs/${jobId}`);
    // The admin job page renders the same rows server-side, so without this an
    // admin watching a cleaner work sees a stale grid until a hard reload.
    revalidatePath(`/admin/jobs/${jobId}`);

    return { success: true, photo, kindLabel: jobPhotoKindLabel(kind) };
  } catch (error) {
    console.error("Error uploading job photo:", error);
    return { success: false, error: "Failed to upload photo" };
  }
}
