// POST /api/v1/uploads — sign one direct upload to Cloudinary for a job photo.
// The server picks the public_id and signs exactly the fields it returns; the
// API secret never leaves the server (packages/api/src/v1/photos.ts).
import { UploadRequest, UploadTicket } from "@bookmops/api/v1";

import { signJobPhotoUpload } from "@/server/photos/photos";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route(
  {
    host: "tenant",
    access: "staff",
    body: UploadRequest,
    response: UploadTicket,
    // Each ticket is storage the company pays for (API_V1.md §4).
    limit: { name: "upload-sign", max: 60, windowMs: 60 * 60_000 },
  },
  (ctx) =>
    signJobPhotoUpload(ctx.actor, {
      orgSlug: ctx.org.slug,
      jobId: pathId(ctx.body.jobId),
      contentType: ctx.body.contentType,
      byteSize: ctx.body.byteSize,
      now: ctx.receivedAt,
    }),
);
