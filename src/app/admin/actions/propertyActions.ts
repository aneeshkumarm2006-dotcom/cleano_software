"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { FIELD_TYPES, OBJECT_TYPES, GROUPS, HAS_OPTIONS, toInternal } from "@/lib/prop-engine-meta";

type Result = { success: true; id?: string } | { error: string };

async function gate(): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") return { error: "Forbidden" };
  return { ok: true };
}

const FIELD_IDS = new Set(FIELD_TYPES.map((f) => f.id));
const OBJECT_IDS = new Set(OBJECT_TYPES.map((o) => o.id));

type PropertyInput = {
  label: string;
  objectType: string;
  groupName: string;
  fieldType: string;
  options: string[];
  isRequired: boolean;
  isUnique: boolean;
  visibility: string;
};

function clean(input: PropertyInput) {
  const label = input.label.trim();
  const options = HAS_OPTIONS.has(input.fieldType)
    ? input.options.map((o) => o.trim()).filter(Boolean)
    : [];
  return { label, options, visibility: input.visibility === "admin" ? "admin" : "everyone" };
}

export async function createPropertyDefinition(input: PropertyInput): Promise<Result> {
  const g = await gate();
  if ("error" in g) return g;
  const { label, options, visibility } = clean(input);
  if (!label) return { error: "Label is required" };
  if (!OBJECT_IDS.has(input.objectType)) return { error: "Invalid object type" };
  if (!FIELD_IDS.has(input.fieldType)) return { error: "Invalid field type" };
  const groupName = GROUPS.includes(input.groupName) ? input.groupName : "Contact info";

  const internalName = toInternal(label);
  if (!internalName) return { error: "Could not derive an internal name from the label" };

  try {
    const existing = await db.propertyDefinition.findUnique({
      where: { objectType_internalName: { objectType: input.objectType, internalName } },
    });
    if (existing) return { error: `A property with internal name "${internalName}" already exists on this object` };

    const max = await db.propertyDefinition.aggregate({
      where: { objectType: input.objectType, groupName },
      _max: { sortOrder: true },
    });

    const created = await db.propertyDefinition.create({
      data: {
        objectType: input.objectType,
        groupName,
        label,
        internalName,
        fieldType: input.fieldType,
        options,
        isSystem: false,
        isRequired: !!input.isRequired,
        isUnique: !!input.isUnique,
        visibility,
        sortOrder: (max._max.sortOrder ?? 0) + 1,
      },
    });
    revalidatePath("/admin/properties");
    return { success: true, id: created.id };
  } catch (e) {
    console.error("createPropertyDefinition", e);
    return { error: "Failed to create property" };
  }
}

export async function updatePropertyDefinition(id: string, input: PropertyInput): Promise<Result> {
  const g = await gate();
  if ("error" in g) return g;
  const { label, options, visibility } = clean(input);
  if (!label) return { error: "Label is required" };

  try {
    const existing = await db.propertyDefinition.findUnique({ where: { id } });
    if (!existing) return { error: "Property not found" };

    // System fields: only label, options and visibility may change — type and
    // internal name are locked.
    const data = existing.isSystem
      ? { label, options, visibility }
      : {
          label,
          options,
          visibility,
          fieldType: FIELD_IDS.has(input.fieldType) ? input.fieldType : existing.fieldType,
          isRequired: !!input.isRequired,
          isUnique: !!input.isUnique,
        };

    await db.propertyDefinition.update({ where: { id }, data });
    revalidatePath("/admin/properties");
    return { success: true };
  } catch (e) {
    console.error("updatePropertyDefinition", e);
    return { error: "Failed to update property" };
  }
}

export async function deletePropertyDefinition(id: string): Promise<Result> {
  const g = await gate();
  if ("error" in g) return g;
  try {
    const existing = await db.propertyDefinition.findUnique({ where: { id } });
    if (!existing) return { error: "Property not found" };
    if (existing.isSystem) return { error: "System properties cannot be deleted" };
    await db.propertyDefinition.update({ where: { id }, data: { archivedAt: new Date() } });
    revalidatePath("/admin/properties");
    return { success: true };
  } catch (e) {
    console.error("deletePropertyDefinition", e);
    return { error: "Failed to delete property" };
  }
}
