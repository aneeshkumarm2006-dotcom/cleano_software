import "server-only";
import { db } from "@/lib/org-db";
import type { PropertyDef } from "@/lib/prop-engine-meta";

export async function listObjectProperties(objectType: string): Promise<PropertyDef[]> {
  const rows = await db.propertyDefinition.findMany({
    where: { objectType, archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
  return rows.map(serialize);
}

export async function listPropertyDefinitions(): Promise<PropertyDef[]> {
  const rows = await db.propertyDefinition.findMany({
    where: { archivedAt: null },
    orderBy: [{ objectType: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
  });
  return rows.map(serialize);
}

function serialize(r: {
  id: string; objectType: string; groupName: string; label: string; internalName: string;
  fieldType: string; options: string[]; isSystem: boolean; isRequired: boolean; isUnique: boolean;
  visibility: string; sortOrder: number;
}): PropertyDef {
  return {
    id: r.id,
    objectType: r.objectType,
    groupName: r.groupName,
    label: r.label,
    internalName: r.internalName,
    fieldType: r.fieldType,
    options: r.options,
    isSystem: r.isSystem,
    isRequired: r.isRequired,
    isUnique: r.isUnique,
    visibility: r.visibility,
    sortOrder: r.sortOrder,
  };
}
