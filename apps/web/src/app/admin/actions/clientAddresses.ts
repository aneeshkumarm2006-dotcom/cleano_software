"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/org-db";
import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity-log";
import { parsePropertyCount, readPropertySize } from "@/lib/property-size";
import { parsePropertyType } from "@/lib/property-type";

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const role = (session.user as any).role;
  if (role !== "ADMIN" && role !== "OWNER") return null;
  return session;
}

/**
 * awerfixes.pdf item 2 (round 3, stage 4) — the address book grew city, postal
 * code and access notes.
 *
 * `accessNotes` holds door codes, gate codes and buzzer numbers, and it is
 * surfaced to the assigned cleaner on the job page. That is the reason these
 * three actions now write to the activity log: before this stage the file had
 * no audit trail at all (unlike its sibling clientPaymentMethods.ts), and
 * "who changed the door code, and when" is a question someone will eventually
 * need answered. The note text itself is never logged — only that it changed.
 */
const readAddressForm = (formData: FormData) => ({
  label: (formData.get("label") as string)?.trim() || "Home",
  address: (formData.get("address") as string)?.trim(),
  aptNumber: (formData.get("aptNumber") as string)?.trim() || null,
  city: (formData.get("city") as string)?.trim() || null,
  postalCode: (formData.get("postalCode") as string)?.trim() || null,
  accessNotes: (formData.get("accessNotes") as string)?.trim() || null,
  // Property size (item 3). This is the EDITOR, so unlike the blanks-only
  // enrichment `upsertClientAddress` does, a blank here is an instruction:
  // clearing the bedrooms field means "we no longer know", and it saves as
  // NULL. `parsePropertyCount` keeps 0 (a studio) distinct from blank.
  ...readPropertySize({
    propertyType: parsePropertyType(formData.get("propertyType")),
    bedCount: parsePropertyCount(formData.get("bedCount")),
    bathCount: parsePropertyCount(formData.get("bathCount")),
    halfBathCount: parsePropertyCount(formData.get("halfBathCount")),
    squareFootage: parsePropertyCount(formData.get("squareFootage")),
  }),
  makeDefault: formData.get("isDefault") === "on",
});

async function logAddressChange(
  session: Awaited<ReturnType<typeof requireAdmin>>,
  action: string,
  clientId: string,
  addressId: string,
  hasAccessNotes: boolean
) {
  await logActivity({
    category: "ADMIN",
    action,
    status: "SUCCESS",
    actorId: session?.user?.id ?? null,
    actorLabel: (session?.user as { role?: string } | undefined)?.role ?? null,
    targetType: "Client",
    targetId: clientId,
    message: `Saved address ${action.replace("client_address.", "")}`,
    // Deliberately records only WHETHER access notes are present, never the
    // codes themselves — the audit log must not become a second copy of them.
    metadata: { addressId, hasAccessNotes },
  });
}

export async function addClientAddress(formData: FormData) {
  const session = await requireAdmin();
  if (!session) return { error: "Forbidden" };

  const clientId = formData.get("clientId") as string;
  const f = readAddressForm(formData);

  if (!clientId || !f.address) return { error: "Address is required" };

  if (f.makeDefault) {
    await db.clientAddress.updateMany({ where: { clientId }, data: { isDefault: false } });
  }

  const created = await db.clientAddress.create({
    data: {
      clientId,
      label: f.label,
      address: f.address,
      aptNumber: f.aptNumber,
      city: f.city,
      postalCode: f.postalCode,
      accessNotes: f.accessNotes,
      propertyType: f.propertyType,
      bedCount: f.bedCount,
      bathCount: f.bathCount,
      halfBathCount: f.halfBathCount,
      squareFootage: f.squareFootage,
      isDefault: f.makeDefault,
    },
    select: { id: true },
  });

  await logAddressChange(session, "client_address.created", clientId, created.id, !!f.accessNotes);

  revalidatePath(`/admin/clients/${clientId}`);
  return { success: true };
}

export async function updateClientAddress(formData: FormData) {
  const session = await requireAdmin();
  if (!session) return { error: "Forbidden" };

  const id = formData.get("id") as string;
  const f = readAddressForm(formData);

  if (!id || !f.address) return { error: "Address is required" };

  const existing = await db.clientAddress.findUnique({ where: { id } });
  if (!existing) return { error: "Not found" };

  if (f.makeDefault) {
    await db.clientAddress.updateMany({ where: { clientId: existing.clientId }, data: { isDefault: false } });
  }

  await db.clientAddress.update({
    where: { id },
    data: {
      label: f.label,
      address: f.address,
      aptNumber: f.aptNumber,
      city: f.city,
      postalCode: f.postalCode,
      accessNotes: f.accessNotes,
      propertyType: f.propertyType,
      bedCount: f.bedCount,
      bathCount: f.bathCount,
      halfBathCount: f.halfBathCount,
      squareFootage: f.squareFootage,
      isDefault: f.makeDefault,
    },
  });

  await logAddressChange(
    session,
    "client_address.updated",
    existing.clientId,
    id,
    !!f.accessNotes
  );

  revalidatePath(`/admin/clients/${existing.clientId}`);
  return { success: true };
}

export async function deleteClientAddress(id: string) {
  const session = await requireAdmin();
  if (!session) return { error: "Forbidden" };

  const existing = await db.clientAddress.findUnique({ where: { id } });
  if (!existing) return { error: "Not found" };

  // Job.clientAddressId is ON DELETE SET NULL, so jobs booked against this
  // address keep their `location`/`aptNumber` snapshot and only lose the
  // provenance pointer. Nothing scheduled or invoiced is damaged by a delete,
  // which is why this stays a hard delete.
  await db.clientAddress.delete({ where: { id } });

  await logAddressChange(
    session,
    "client_address.deleted",
    existing.clientId,
    id,
    !!existing.accessNotes
  );

  revalidatePath(`/admin/clients/${existing.clientId}`);
  return { success: true };
}
