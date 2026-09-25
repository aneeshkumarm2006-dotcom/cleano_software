// Sample job photos for development builds, held in memory so adding and
// deleting a photo actually sticks. Tickets point at PREVIEW_UPLOAD_ORIGIN
// instead of Cloudinary; the uploader recognises it in development builds and
// simulates the form POST (with progress, and a failure now and then so retry
// can be seen) instead of sending.
import { ApiError } from "@bookmops/api/client";
import type { JobPhoto, JobPhotosResponse, PhotoPolicy } from "@bookmops/api/v1";
import { randomUUID } from "expo-crypto";

import { PREVIEW_UPLOAD_ORIGIN } from "@/features/photos/upload";

import type { DataSource } from "../source";
import { delay } from "./delay";
import { previewMe } from "./jobs";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** A stable stand-in image. The app shows its own copy of a photo it just took. */
const sample = (seed: string, w = 900, h = 1200) => `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`;

function photo(id: string, over: Partial<JobPhoto>): JobPhoto {
  return {
    id,
    kind: "BEFORE",
    url: sample(id),
    thumbnailUrl: sample(id, 300, 300),
    caption: null,
    takenAt: ago(30),
    takenBy: "Amara",
    mine: true,
    canDelete: true,
    ...over,
  };
}

const photos = new Map<string, JobPhoto[]>();
function photosOf(jobId: string): JobPhoto[] {
  let p = photos.get(jobId);
  if (!p) {
    p = [
      photo(`${jobId}-p1`, { takenAt: ago(12) }),
      photo(`${jobId}-p2`, { takenAt: ago(14) }),
      photo(`${jobId}-p3`, { takenAt: ago(16), takenBy: "Sofia", mine: false, canDelete: false }),
      photo(`${jobId}-p4`, { kind: "GENERAL", takenAt: ago(60 * 24 * 3), takenBy: null, mine: false, canDelete: false }),
    ];
    photos.set(jobId, p);
  }
  return p;
}

/** The sample job whose photos the office has turned off. */
const PHOTOS_OFF_JOB = "j2";

const POLICY: PhotoPolicy = {
  canAdd: true,
  closedReason: null,
  // j2 shows what a job with photos turned off looks like.
  photosAllowed: true,
  maxPhotos: 200,
  maxBytes: 10 * 1024 * 1024,
};

/** Public ids signed in this session, so attach can check them as the server would. */
const signed = new Map<string, string>();
/** Attach is idempotent on clientEventId, as the server's is. */
const attached = new Map<string, JobPhoto>();

export const previewPhotosApi = {
  createJobPhotoUpload: (body) => {
    // Shaped like the server's: the company's folder, the job, the person, a random name.
    const key = `preview/${previewMe().company.id}/jobs/${body.jobId}/${previewMe().person.id}/${randomUUID()}`;
    signed.set(key, body.jobId);
    const timestamp = Math.floor(Date.now() / 1000);
    return delay(
      {
        uploadUrl: PREVIEW_UPLOAD_ORIGIN,
        method: "MULTIPART_POST" as const,
        fields: {
          api_key: "preview",
          timestamp: String(timestamp),
          public_id: key,
          allowed_formats: "jpg,png,heic,heif,webp",
          overwrite: "false",
          signature: "preview",
        },
        fileField: "file",
        key,
        expiresAt: new Date((timestamp + 60 * 60) * 1000).toISOString(),
      },
      200,
    );
  },
  jobPhotos: (jobId) => {
    const items = photosOf(jobId);
    const res: JobPhotosResponse = {
      items,
      nextCursor: null,
      total: items.length,
      policy: jobId === PHOTOS_OFF_JOB ? { ...POLICY, canAdd: false, photosAllowed: false } : POLICY,
    };
    return delay(res);
  },
  attachJobPhoto: async (jobId, body) => {
    const again = attached.get(body.clientEventId);
    if (again) return delay(again, 150);
    if (signed.get(body.key) !== jobId) {
      await delay(null, 200);
      throw new ApiError("That photo didn't reach us. Try again.", 404, "NOT_FOUND", false);
    }
    if (jobId === PHOTOS_OFF_JOB) {
      await delay(null, 200);
      throw new ApiError("The office has turned photos off for this job.", 409, "PHOTOS_OFF", false);
    }
    const p = photo(`ph-${body.clientEventId.slice(0, 8)}`, { kind: body.phase, takenAt: new Date().toISOString() });
    photos.set(jobId, [p, ...photosOf(jobId)]);
    attached.set(body.clientEventId, p);
    return delay(p, 250);
  },
  deleteJobPhoto: async (jobId, photoId) => {
    const list = photosOf(jobId);
    const target = list.find((p) => p.id === photoId);
    if (!target || !target.canDelete) {
      await delay(null, 200);
      throw new ApiError("This photo isn't available.", 404, "NOT_FOUND", false);
    }
    photos.set(jobId, list.filter((p) => p.id !== photoId));
    return delay({ id: photoId }, 250);
  },
} satisfies Pick<DataSource, "createJobPhotoUpload" | "jobPhotos" | "attachJobPhoto" | "deleteJobPhoto">;
