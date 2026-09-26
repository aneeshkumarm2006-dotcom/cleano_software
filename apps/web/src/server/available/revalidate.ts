// What a claim makes stale, in one place (API_V1.md §5, "Invalidation is
// shared"). A claim from the phone changes the web's board and the cleaner's
// own screens just as one from the web does. The paths are exactly the ones
// the web's claimJob action revalidated.
import "server-only";

import { revalidatePath } from "next/cache";

export function revalidateAfterClaim(): void {
  revalidatePath("/cleaners/available-jobs");
  revalidatePath("/cleaners/my-jobs");
  revalidatePath("/cleaners/calendar");
  revalidatePath("/cleaners/dashboard");
}
