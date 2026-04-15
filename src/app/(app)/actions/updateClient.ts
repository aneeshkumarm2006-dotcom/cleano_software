"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";

export async function updateClient(formData: FormData) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const role = (session.user as any).role;
  if (role !== "ADMIN" && role !== "OWNER") {
    return { error: "Forbidden" };
  }

  const id = formData.get("id") as string;
  if (!id) return { error: "Client id is required" };

  const name = (formData.get("name") as string)?.trim();
  if (!name) return { error: "Client name is required" };

  try {
    await db.client.update({
      where: { id },
      data: {
        name,
        email: (formData.get("email") as string) || null,
        phone: (formData.get("phone") as string) || null,
        address: (formData.get("address") as string) || null,
        notes: (formData.get("notes") as string) || null,
      },
    });

    revalidatePath("/clients");
    revalidatePath(`/clients/${id}`);
    return { success: true };
  } catch (error) {
    console.error("Error updating client:", error);
    return { error: "Failed to update client" };
  }
}
