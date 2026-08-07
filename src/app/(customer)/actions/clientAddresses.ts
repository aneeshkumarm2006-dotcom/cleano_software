"use server";

/**
 * Customer-facing address book (awerfixes.pdf item 2, round 3, stage 4).
 *
 * The portal used to expose a single "Default address" textbox writing the flat
 * `Client.address` scalar — the same column every web booking silently
 * overwrote, so a customer with two properties could never keep both.
 *
 * These mirror the ADMIN/OWNER actions in app/admin/actions/clientAddresses.ts,
 * with one difference that matters: the client is resolved FROM THE SESSION and
 * every query is scoped by that id. No action here accepts a clientId from the
 * caller, so a customer cannot read or write another customer's addresses by
 * editing a form field. Ownership of a row is re-checked on every write.
 */

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  SAVED_ADDRESS_ORDER,
  SAVED_ADDRESS_SELECT,
} from "@/lib/client-address-store";
import type { SavedAddress } from "@/lib/client-address";

/** The signed-in customer's Client row, by the lowercased-email join key the
 *  whole portal uses. Null when there is no session or no linked record. */
async function currentClientId(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const email = session.user.email?.toLowerCase();
  if (!email) return null;
  const client = await db.client.findFirst({
    where: { email },
    select: { id: true },
  });
  return client?.id ?? null;
}

/** Confirm this address belongs to the signed-in customer before touching it. */
async function ownedAddress(clientId: string, id: string) {
  return db.clientAddress.findFirst({
    where: { id, clientId },
    select: { id: true },
  });
}

const readForm = (formData: FormData) => ({
  label: (formData.get("label") as string)?.trim() || "Home",
  address: (formData.get("address") as string)?.trim(),
  aptNumber: (formData.get("aptNumber") as string)?.trim() || null,
  city: (formData.get("city") as string)?.trim() || null,
  postalCode: (formData.get("postalCode") as string)?.trim() || null,
  accessNotes: (formData.get("accessNotes") as string)?.trim() || null,
  makeDefault: formData.get("isDefault") === "on",
});

const revalidate = () => {
  revalidatePath("/account");
  revalidatePath("/book");
};

/**
 * Read-only list, also used by /book to offer the Step 2 dropdown.
 * Returns [] rather than throwing for a signed-out visitor, because the public
 * booking flow calls this speculatively and must keep working without a session.
 */
export async function getMyAddresses(): Promise<SavedAddress[]> {
  const clientId = await currentClientId();
  if (!clientId) return [];
  return db.clientAddress.findMany({
    where: { clientId },
    orderBy: SAVED_ADDRESS_ORDER,
    select: SAVED_ADDRESS_SELECT,
  });
}

export async function addMyAddress(formData: FormData) {
  const clientId = await currentClientId();
  if (!clientId) return { error: "Not authenticated" };

  const f = readForm(formData);
  if (!f.address) return { error: "Address is required" };

  // The customer's very first address becomes the default whether or not they
  // ticked the box — otherwise their book would have no default at all.
  const count = await db.clientAddress.count({ where: { clientId } });
  const makeDefault = f.makeDefault || count === 0;

  if (makeDefault) {
    await db.clientAddress.updateMany({ where: { clientId }, data: { isDefault: false } });
  }

  await db.clientAddress.create({
    data: {
      clientId,
      label: f.label,
      address: f.address,
      aptNumber: f.aptNumber,
      city: f.city,
      postalCode: f.postalCode,
      accessNotes: f.accessNotes,
      isDefault: makeDefault,
    },
  });

  revalidate();
  return { success: true };
}

export async function updateMyAddress(formData: FormData) {
  const clientId = await currentClientId();
  if (!clientId) return { error: "Not authenticated" };

  const id = formData.get("id") as string;
  const f = readForm(formData);
  if (!id || !f.address) return { error: "Address is required" };
  if (!(await ownedAddress(clientId, id))) return { error: "Not found" };

  if (f.makeDefault) {
    await db.clientAddress.updateMany({ where: { clientId }, data: { isDefault: false } });
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
      isDefault: f.makeDefault,
    },
  });

  revalidate();
  return { success: true };
}

export async function deleteMyAddress(id: string) {
  const clientId = await currentClientId();
  if (!clientId) return { error: "Not authenticated" };
  if (!(await ownedAddress(clientId, id))) return { error: "Not found" };

  const wasDefault = await db.clientAddress.findUnique({
    where: { id },
    select: { isDefault: true },
  });

  // Job.clientAddressId is ON DELETE SET NULL, so upcoming bookings keep the
  // address they were booked at — only the pointer goes. Nothing a customer
  // does here can blank a scheduled job's location.
  await db.clientAddress.delete({ where: { id } });

  // Never leave the book without a default: promote the oldest survivor.
  if (wasDefault?.isDefault) {
    const next = await db.clientAddress.findFirst({
      where: { clientId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (next) {
      await db.clientAddress.update({
        where: { id: next.id },
        data: { isDefault: true },
      });
    }
  }

  revalidate();
  return { success: true };
}
