// What a withdrawal request makes stale (API_V1.md §5, "Invalidation is
// shared"): the path the web's requestWithdrawal action revalidated.
import "server-only";

import { revalidatePath } from "next/cache";

export function revalidateAfterWithdrawal(): void {
  revalidatePath("/cleaners/my-pay");
}
