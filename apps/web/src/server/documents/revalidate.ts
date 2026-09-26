// What signing a document makes stale, in one place, so a signature from the
// phone refreshes the office's screens exactly as one from the web does. The
// paths are the ones the web's signDocument revalidated.
import "server-only";

import { revalidatePath } from "next/cache";

export function revalidateAfterSign(documentId: string): void {
  revalidatePath("/admin/documents");
  revalidatePath(`/admin/documents/${documentId}`);
  revalidatePath("/cleaners/documents");
  revalidatePath(`/cleaners/documents/${documentId}`);
  revalidatePath("/admin/settings");
}
