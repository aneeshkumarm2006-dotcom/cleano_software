"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const role = (session.user as any).role;
  if (role !== "ADMIN" && role !== "OWNER") return null;
  return session;
}

export async function addClientAddress(formData: FormData) {
  if (!(await requireAdmin())) return { error: "Forbidden" };

  const clientId = formData.get("clientId") as string;
  const label = (formData.get("label") as string)?.trim() || "Home";
  const address = (formData.get("address") as string)?.trim();
  const aptNumber = (formData.get("aptNumber") as string)?.trim() || null;
  const makeDefault = formData.get("isDefault") === "on";

  if (!clientId || !address) return { error: "Address is required" };

  if (makeDefault) {
    await db.clientAddress.updateMany({ where: { clientId }, data: { isDefault: false } });
  }

  await db.clientAddress.create({
    data: { clientId, label, address, aptNumber, isDefault: makeDefault },
  });

  revalidatePath(`/admin/clients/${clientId}`);
  return { success: true };
}

export async function updateClientAddress(formData: FormData) {
  if (!(await requireAdmin())) return { error: "Forbidden" };

  const id = formData.get("id") as string;
  const label = (formData.get("label") as string)?.trim() || "Home";
  const address = (formData.get("address") as string)?.trim();
  const aptNumber = (formData.get("aptNumber") as string)?.trim() || null;
  const makeDefault = formData.get("isDefault") === "on";

  if (!id || !address) return { error: "Address is required" };

  const existing = await db.clientAddress.findUnique({ where: { id } });
  if (!existing) return { error: "Not found" };

  if (makeDefault) {
    await db.clientAddress.updateMany({ where: { clientId: existing.clientId }, data: { isDefault: false } });
  }

  await db.clientAddress.update({
    where: { id },
    data: { label, address, aptNumber, isDefault: makeDefault },
  });

  revalidatePath(`/admin/clients/${existing.clientId}`);
  return { success: true };
}

export async function deleteClientAddress(id: string) {
  if (!(await requireAdmin())) return { error: "Forbidden" };

  const existing = await db.clientAddress.findUnique({ where: { id } });
  if (!existing) return { error: "Not found" };

  await db.clientAddress.delete({ where: { id } });
  revalidatePath(`/admin/clients/${existing.clientId}`);
  return { success: true };
}
