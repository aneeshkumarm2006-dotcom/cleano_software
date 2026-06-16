"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import type { LifecycleStage, ContactActivityType, Prisma } from "@prisma/client";

type Result = { success: true } | { error: string };

async function requireAdmin(): Promise<{ name: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { error: "Forbidden" };
  }
  return { name: session.user.name ?? "Admin" };
}

function revalidateContact(id: string) {
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${id}`);
}

// Top-level editable fields (Contact info, source, owner, next step…).
const EDITABLE_FIELDS = new Set([
  "name", "email", "phone", "address", "source", "sourceDetail",
  "campaign", "nextStep", "ownerId",
]);

export async function updateContactField(id: string, field: string, value: string | null): Promise<Result> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  if (!EDITABLE_FIELDS.has(field)) return { error: "Field not editable" };
  try {
    await db.contact.update({
      where: { id },
      data: { [field]: value === "" ? null : value, lastActivityAt: new Date() },
    });
    revalidateContact(id);
    return { success: true };
  } catch (e) {
    console.error("updateContactField", e);
    return { error: "Failed to update contact" };
  }
}

export async function updateContactProp(
  id: string,
  key: string,
  value: string | number | null
): Promise<Result> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  try {
    const existing = await db.contact.findUnique({ where: { id }, select: { props: true } });
    if (!existing) return { error: "Contact not found" };
    const props = { ...((existing.props as Record<string, unknown>) ?? {}), [key]: value };
    await db.contact.update({
      where: { id },
      data: { props: props as Prisma.InputJsonValue, lastActivityAt: new Date() },
    });
    revalidateContact(id);
    return { success: true };
  } catch (e) {
    console.error("updateContactProp", e);
    return { error: "Failed to update property" };
  }
}

export async function setContactLifecycle(id: string, stage: LifecycleStage): Promise<Result> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  try {
    await db.$transaction([
      db.contact.update({ where: { id }, data: { lifecycle: stage, lastActivityAt: new Date() } }),
      db.contactActivity.create({
        data: {
          contactId: id,
          type: "LIFECYCLE",
          title: `Lifecycle → ${stage.replace("_", " ").toLowerCase()}`,
          actor: "name" in gate ? gate.name : "Admin",
        },
      }),
    ]);
    revalidateContact(id);
    return { success: true };
  } catch (e) {
    console.error("setContactLifecycle", e);
    return { error: "Failed to update lifecycle" };
  }
}

const ACTIVITY_TYPES = new Set<ContactActivityType>(["NOTE", "CALL", "EMAIL", "SMS"]);

export async function logContactActivity(
  id: string,
  type: ContactActivityType,
  text: string
): Promise<Result> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  if (!ACTIVITY_TYPES.has(type)) return { error: "Invalid activity type" };
  const body = text.trim();
  if (!body) return { error: "Note cannot be empty" };
  const titleMap: Record<string, string> = {
    NOTE: "Note logged",
    CALL: "Call logged",
    EMAIL: "Email logged",
    SMS: "SMS logged",
  };
  try {
    await db.$transaction([
      db.contactActivity.create({
        data: { contactId: id, type, title: titleMap[type], body, actor: "name" in gate ? gate.name : "Admin" },
      }),
      db.contact.update({ where: { id }, data: { lastActivityAt: new Date() } }),
    ]);
    revalidateContact(id);
    return { success: true };
  } catch (e) {
    console.error("logContactActivity", e);
    return { error: "Failed to log activity" };
  }
}

/**
 * Merge a duplicate group into one master. `choices` maps each mergeable field
 * to the contact id whose value should win. Losing records are archived (soft-
 * deleted) and an audit entry is written to the master's timeline.
 */
export async function mergeContacts(
  masterId: string,
  memberIds: string[],
  choices: Record<string, string>
): Promise<Result> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  const loserIds = memberIds.filter((id) => id !== masterId);
  if (!loserIds.length) return { error: "Nothing to merge" };
  try {
    const members = await db.contact.findMany({ where: { id: { in: [masterId, ...loserIds] } } });
    const map = new Map(members.map((m) => [m.id, m]));
    const master = map.get(masterId);
    if (!master) return { error: "Master record not found" };
    const pick = (k: string) => map.get(choices[k] ?? masterId) ?? master;

    const data: Prisma.ContactUpdateInput = {
      duplicateDismissed: false,
      lastActivityAt: new Date(),
      tags: (master.tags ?? []).filter((t) => t !== "Possible duplicate"),
    };
    if (choices.name) data.name = pick("name").name;
    if (choices.email) data.email = pick("email").email;
    if (choices.phone) data.phone = pick("phone").phone;
    if (choices.address) data.address = pick("address").address;
    if (choices.lifecycle) data.lifecycle = pick("lifecycle").lifecycle;
    if (choices.source) { const s = pick("source"); data.source = s.source; data.sourceDetail = s.sourceDetail; }
    if (choices.owner) data.ownerId = pick("owner").ownerId;
    if (choices.leadScore) data.leadScore = pick("leadScore").leadScore;

    await db.$transaction([
      db.contact.update({ where: { id: masterId }, data }),
      db.contact.updateMany({ where: { id: { in: loserIds } }, data: { archivedAt: new Date(), duplicateDismissed: true } }),
      db.contactActivity.create({
        data: {
          contactId: masterId,
          type: "LIFECYCLE",
          title: `Merged ${loserIds.length} duplicate${loserIds.length > 1 ? "s" : ""}`,
          body: "Old values archived to the audit log",
          actor: "name" in gate ? gate.name : "Admin",
        },
      }),
    ]);
    revalidatePath("/contacts");
    revalidatePath("/contacts/duplicates");
    revalidatePath(`/contacts/${masterId}`);
    return { success: true };
  } catch (e) {
    console.error("mergeContacts", e);
    return { error: "Failed to merge contacts" };
  }
}

/** Mark every record in a group as "not a duplicate" so the group disappears. */
export async function dismissDuplicateGroup(memberIds: string[]): Promise<Result> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  try {
    await db.contact.updateMany({ where: { id: { in: memberIds } }, data: { duplicateDismissed: true } });
    revalidatePath("/contacts");
    revalidatePath("/contacts/duplicates");
    return { success: true };
  } catch (e) {
    console.error("dismissDuplicateGroup", e);
    return { error: "Failed to dismiss group" };
  }
}

export async function dismissContactDuplicates(id: string): Promise<Result> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;
  try {
    await db.contact.update({ where: { id }, data: { duplicateDismissed: true } });
    revalidateContact(id);
    return { success: true };
  } catch (e) {
    console.error("dismissContactDuplicates", e);
    return { error: "Failed to dismiss duplicates" };
  }
}
