"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

type Status = "NEW" | "CONTACTED" | "CONVERTED" | "ARCHIVED";

export async function updateQuoteStatus(input: {
  quoteId: string;
  status: Status;
  notes?: string;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER") {
    return { success: false, error: "Not authorized" };
  }

  await db.quoteRequest.update({
    where: { id: input.quoteId },
    data: {
      status: input.status,
      ...(input.notes !== undefined ? { notes: input.notes.trim() || null } : {}),
    },
  });

  revalidatePath("/admin/quotes");
  return { success: true };
}
