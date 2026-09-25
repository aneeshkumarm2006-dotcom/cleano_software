// DELETE /api/v1/jobs/:id/photos/:photoId — the caller's own photo on this
// job, and its Cloudinary asset. Anyone else's, or a second delete, is 404.
import { DeletePhotoResponse } from "@bookmops/api/v1";

import { deleteJobPhotoFor } from "@/server/photos/photos";
import { revalidatePhotoSurfaces } from "@/server/photos/revalidate";
import { ok } from "@/server/result";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const DELETE = v1Route(
  { host: "tenant", access: "staff", response: DeletePhotoResponse },
  async (ctx) => {
    const jobId = pathId(ctx.params.jobId);
    const res = await deleteJobPhotoFor(ctx.actor, { photoId: pathId(ctx.params.photoId), jobId, door: "phone" });
    if (!res.ok) return res;
    revalidatePhotoSurfaces(jobId);
    return ok({ id: res.value.id }, res.effects);
  },
);
