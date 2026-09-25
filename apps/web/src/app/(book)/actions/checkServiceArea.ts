"use server";

import { checkServiceAreaInternal } from "@/lib/service-area";

// Public action — no auth required, called from the booking form (Step 1).
export async function checkServiceArea(postalCode: string) {
  if (!postalCode || typeof postalCode !== "string") {
    return { covered: false, error: "Postal code is required" as const };
  }
  return checkServiceAreaInternal(postalCode);
}
