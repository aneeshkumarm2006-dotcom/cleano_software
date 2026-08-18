// Validating a checklist template's CUSTOMER scope (Stage 10 / PDF #10).
//
// Both `createChecklistTemplate` and `updateChecklistTemplate` need the same
// three guarantees before they write `clientId` / `clientAddressId`, and the
// resolver in `checklist-triggers.ts` depends on the third one being true:
//
//   1. the ids exist (a typo'd or stale id must not be stored — a template
//      scoped to a client that isn't there matches nothing, silently, forever);
//   2. the address actually belongs to that client (otherwise "Mckiernan —
//      12 Main St" could point at somebody else's front door);
//   3. an address-scoped template ALWAYS carries its client id too.
//
// (3) is not cosmetic. `ChecklistTemplate.clientAddressId` is ON DELETE SET
// NULL, so deleting the address has to leave the template scoped to the
// customer rather than promoting it to a global list that fires on every job in
// the business. That degradation only works if the client id is there to fall
// back to — see the FK note in the migration.
//
// This lives outside both action files on purpose: a `"use server"` module
// publishes every export as a callable endpoint, and a validation helper is not
// something the browser should be able to call.

import { db } from "@/db";

export interface TemplateScopeInput {
  clientId?: string | null;
  clientAddressId?: string | null;
}

export type TemplateScope =
  | { clientId: string | null; clientAddressId: string | null }
  | { error: string };

export async function resolveTemplateScope(
  input: TemplateScopeInput
): Promise<TemplateScope> {
  const clientId = input.clientId?.trim() || null;
  const clientAddressId = input.clientAddressId?.trim() || null;

  if (!clientId && !clientAddressId) {
    return { clientId: null, clientAddressId: null };
  }

  // An address with no client is the one combination the resolver cannot
  // survive (see the header). Rejected rather than silently repaired, because
  // repairing it means guessing which customer was meant.
  if (!clientId && clientAddressId) {
    return { error: "Pick the customer before picking one of their locations." };
  }

  const client = await db.client.findFirst({
    where: { id: clientId!, deletedAt: null },
    select: { id: true },
  });
  if (!client) {
    return { error: "That customer no longer exists." };
  }

  if (!clientAddressId) {
    return { clientId: client.id, clientAddressId: null };
  }

  const address = await db.clientAddress.findFirst({
    where: { id: clientAddressId, clientId: client.id },
    select: { id: true },
  });
  if (!address) {
    return { error: "That location does not belong to the selected customer." };
  }

  return { clientId: client.id, clientAddressId: address.id };
}
