"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { cloudinary } from "@/lib/cloudinary";
import { jobPhotoKindLabel, MAX_PHOTOS_PER_JOB, parseJobPhotoKind } from "@bookmops/core/jobs";
import type { UploadApiResponse } from "cloudinary";
import { orgAssetFolder } from "@/lib/asset-folder";
import { requireOrgId } from "@/lib/org";
import { actorFromSession } from "@/server/actor";
import {
  firstPhotoEffects,
  insertJobPhoto,
  jobForCrew,
  photoLimitMessage,
  photoSwitchBlocks,
  PHOTOS_OFF_MESSAGE,
} from "@/server/photos/photos";

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
    // The job and who may add to it, the photo switch, the cap and the insert
    // are shared with the phone (server/photos/photos.ts); the messages here
    // are the ones this action always gave.
    const actor = actorFromSession(
      session.user as { id: string; name?: string | null; email: string; role?: string | null },
      await requireOrgId(),
    );
    const access = await jobForCrew(actor, jobId, "web");
    if (!access.job) {
      return {
        success: false,
        error: access.reason === "NOT_FOUND" ? "Job not found" : "Not authorized for this job",
      };
    }
    const job = access.job;

    // After-photos are allowed by default (item 21); this gate only fires
    // when an admin explicitly disabled them for this job. Admins bypass.
    //
    // So does an ISSUE photo: an after-photo policy is about documenting a
    // finished clean, and it must never be the reason the office does not get
    // to see the damage a cleaner is standing in front of.
    if (photoSwitchBlocks(actor, job, kind)) {
      return { success: false, error: PHOTOS_OFF_MESSAGE };
    }

    // The cap is now `MAX_PHOTOS_PER_JOB` (200), up from a hardcoded 20 that
    // lived in two files at once — see packages/core/src/jobs/job-photos.ts for why a ceiling
    // still exists at all. The widget prints the same number before a cleaner
    // picks a file, so reaching this branch should mean a genuinely enormous
    // job, not a surprise. Checked here before the upload, and again in the
    // insert's transaction, which holds the job's row so two uploads at once
    // can't both take the last place.
    const existingCount = await db.jobPhoto.count({ where: { jobId } });
    if (existingCount >= MAX_PHOTOS_PER_JOB) {
      return { success: false, error: photoLimitMessage(existingCount) };
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const folder = await orgAssetFolder("jobs", jobId);
    const publicId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const result = await streamUpload(buffer, folder, publicId);

    const inserted = await insertJobPhoto(
      { job, actor, url: result.secure_url, caption, kind },
      new Date(),
    );
    if (!inserted.ok) {
      // Lost the last place to a concurrent upload: don't leave the file behind.
      await cloudinary.uploader
        .destroy(result.public_id, { resource_type: "image", invalidate: true })
        .catch(() => {});
      return { success: false, error: inserted.message };
    }
    const photo = inserted.value.photo;

    // First photo on this job: tell the team once. The count is read inside
    // the insert's transaction, so zero means this upload is the transition —
    // the same rule the AI handoff uses, and the reason eight photos do not
    // become eight emails.
    //
    // Not for an ISSUE photo. "Photos added" is the wrong headline for a
    // cleaner reporting a problem, and reportIssue.ts sends the mail that
    // actually says what happened — two notifications for one event would
    // train admins to skim past both.
    for (const e of firstPhotoEffects(job, actor, kind, inserted.value.countBefore)) {
      await e.run().catch((err) => console.error("uploadJobPhoto: admin notify failed", err));
    }

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
