// What a photo, an issue report or "on my way" from the phone makes stale on
// the web: the same paths the web's own actions revalidate.
import "server-only";

import { revalidatePath } from "next/cache";

export function revalidatePhotoSurfaces(jobId: string): void {
  revalidatePath(`/cleaners/my-jobs/${jobId}`);
  revalidatePath(`/admin/jobs/${jobId}`);
}

export function revalidateAfterOnMyWay(jobId: string): void {
  revalidatePath("/cleaners/my-jobs");
  revalidatePath(`/cleaners/my-jobs/${jobId}`);
  revalidatePath(`/cleaners/my-jobs/${jobId}/clock`);
  revalidatePath(`/admin/jobs/${jobId}`);
}
