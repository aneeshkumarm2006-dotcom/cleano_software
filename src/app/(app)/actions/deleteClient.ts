"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";

export async function deleteClient(clientId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const role = (session.user as any).role;
  if (role !== "ADMIN" && role !== "OWNER") {
    return { error: "Forbidden" };
  }

  if (!clientId) return { error: "Client id is required" };

  try {
    const jobCount = await db.job.count({ where: { clientId } });
    if (jobCount > 0) {
      return {
        error: `Cannot delete client — ${jobCount} job${
          jobCount === 1 ? "" : "s"
        } linked. Reassign or delete those jobs first.`,
      };
    }

    await db.client.delete({ where: { id: clientId } });
    revalidatePath("/clients");
    return { success: true };
  } catch (error) {
    console.error("Error deleting client:", error);
    return { error: "Failed to delete client" };
  }
}
