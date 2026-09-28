// GET  /api/v1/jobs/:id/photos?cursor=… — every photo on the job, newest
//      first, with what this person may add (packages/api/src/v1/photos.ts).
// POST /api/v1/jobs/:id/photos — attach a signed upload by its key.
//      Idempotent on clientEventId; the key is accepted once.
import { AttachPhotoRequest, JobPhoto, JobPhotosResponse } from "@bookmops/api/v1";
import { z } from "zod";

import { revalidatePhotoSurfaces } from "@/server/photos/revalidate";
import { attachUploadedPhoto, listJobPhotos } from "@/server/photos/photos";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

const PhotosQuery = z.object({ cursor: z.string().max(512).optional() });

export const GET = v1Route(
  { host: "tenant", access: "staff", query: PhotosQuery, response: JobPhotosResponse },
  (ctx) => listJobPhotos(ctx.actor, pathId(ctx.params.jobId), ctx.query.cursor),
);

export const POST = v1Route(
  {
    host: "tenant",
    access: "staff",
    body: AttachPhotoRequest,
    response: JobPhoto,
    idempotent: true,
    limit: { name: "photo-attach", max: 120, windowMs: 60 * 60_000 },
  },
  async (ctx) => {
    const jobId = pathId(ctx.params.jobId);
    const res = await attachUploadedPhoto(ctx.actor, {
      orgSlug: ctx.org.slug,
      jobId,
      key: ctx.body.key,
      phase: ctx.body.phase,
      now: ctx.receivedAt,
    });
    if (res.ok) revalidatePhotoSurfaces(jobId);
    return res;
  },
);
