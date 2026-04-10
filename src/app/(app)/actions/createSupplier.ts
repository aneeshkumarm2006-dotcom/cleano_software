"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";

interface CreateSupplierParams {
  name: string;
  contact?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

interface UpdateSupplierParams extends CreateSupplierParams {
  id: string;
}

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Not authenticated" as const };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { error: "Not authorized" as const };
  }
  return { session };
}

export async function createSupplier(params: CreateSupplierParams) {
  try {
    const guard = await requireAdmin();
    if ("error" in guard) return { success: false, error: guard.error };

    if (!params.name?.trim()) {
      return { success: false, error: "Supplier name is required" };
    }

    const supplier = await db.supplier.create({
      data: {
        name: params.name.trim(),
        contact: params.contact?.trim() || null,
        email: params.email?.trim() || null,
        phone: params.phone?.trim() || null,
        address: params.address?.trim() || null,
        notes: params.notes?.trim() || null,
        isActive: params.isActive ?? true,
      },
    });

    revalidatePath("/settings");
    return { success: true, supplierId: supplier.id };
  } catch (error) {
    console.error("Error creating supplier:", error);
    return { success: false, error: "Failed to create supplier" };
  }
}

export async function updateSupplier(params: UpdateSupplierParams) {
  try {
    const guard = await requireAdmin();
    if ("error" in guard) return { success: false, error: guard.error };

    const { id, ...rest } = params;
    if (!id) return { success: false, error: "Supplier id is required" };
    if (!rest.name?.trim()) {
      return { success: false, error: "Supplier name is required" };
    }

    await db.supplier.update({
      where: { id },
      data: {
        name: rest.name.trim(),
        contact: rest.contact?.trim() || null,
        email: rest.email?.trim() || null,
        phone: rest.phone?.trim() || null,
        address: rest.address?.trim() || null,
        notes: rest.notes?.trim() || null,
        isActive: rest.isActive ?? true,
      },
    });

    revalidatePath("/settings");
    return { success: true };
  } catch (error) {
    console.error("Error updating supplier:", error);
    return { success: false, error: "Failed to update supplier" };
  }
}

export async function deleteSupplier(id: string) {
  try {
    const guard = await requireAdmin();
    if ("error" in guard) return { success: false, error: guard.error };

    await db.supplier.delete({ where: { id } });
    revalidatePath("/settings");
    return { success: true };
  } catch (error) {
    console.error("Error deleting supplier:", error);
    return { success: false, error: "Failed to delete supplier" };
  }
}
