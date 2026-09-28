// What a training change makes stale, in one place, so progress from the
// phone refreshes the web's training pages exactly as the web's own did.
import "server-only";

import { revalidatePath } from "next/cache";

export function revalidateAfterTraining(moduleId: string): void {
  revalidatePath("/admin/training");
  revalidatePath(`/admin/training/${moduleId}`);
  revalidatePath("/cleaners/training");
  revalidatePath(`/cleaners/training/${moduleId}`);
}
