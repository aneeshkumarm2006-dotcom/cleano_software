"use server";

/**
 * Placeholder invalidation hook. In this SWR-based approach the client
 * directly calls mutate on the affected day keys, so this action is a
 * no-op for now. Kept for future expansion (e.g., tag-based revalidation).
 */
export async function invalidateCalendarDay(_dateStr: string) {
  // Intentionally no-op; SWR mutate handles client cache invalidation.
  return { success: true };
}

