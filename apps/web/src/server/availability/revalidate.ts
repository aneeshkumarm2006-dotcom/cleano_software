// What an availability change makes stale (API_V1.md §5). The union of the
// paths setAvailability and availabilityExceptions revalidated.
import "server-only";

import { revalidatePath } from "next/cache";

export function revalidateAfterAvailability(employeeId: string): void {
  revalidatePath("/admin/settings");
  revalidatePath("/cleaners/availability");
  revalidatePath(`/admin/employees/${employeeId}`);
  revalidatePath("/admin/calendar");
  revalidatePath("/admin/jobs/new");
}
