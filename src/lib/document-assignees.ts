// Single source of truth for "who can be assigned a company document".
//
// Documents (handbooks, policies, W-9s, signable agreements) are a staff-facing
// feature: only the crew and the office ever sign them. Imported customers get
// a CLIENT-role User row in the same `user` table, so any assignment query that
// forgets to filter on role sweeps the entire customer book in with the crew.
// That is exactly what "Assign to: all employees" used to do.
import "server-only";
import { db } from "@/lib/org-db";

// Every role that is staff. Mirrors the Roles enum in prisma/schema.prisma
// minus CLIENT.
export const DOCUMENT_ASSIGNABLE_ROLES = [
  "OWNER",
  "ADMIN",
  "OPS_MANAGER",
  "FIELD_LEAD",
  "EMPLOYEE",
] as const;

export type DocumentAssignableRole = (typeof DOCUMENT_ASSIGNABLE_ROLES)[number];

export type DocumentAssignMode = "ALL" | "ROLES" | "USERS";

export interface DocumentAssignInput {
  mode: DocumentAssignMode;
  roles?: DocumentAssignableRole[];
  userIds?: string[];
}

function isAssignableRole(role: string): role is DocumentAssignableRole {
  return (DOCUMENT_ASSIGNABLE_ROLES as readonly string[]).includes(role);
}

/**
 * Resolve an assignment request to the user ids that should actually receive
 * the document. CLIENT accounts are excluded in every mode — including when an
 * admin hand-picks users, since the picker should never have offered them.
 *
 * ALL / ROLES also skip archived (soft-deleted) and deactivated staff; there is
 * no point asking a former cleaner to sign the new handbook. USERS honours an
 * explicit pick of an inactive-but-not-archived person.
 */
export async function resolveDocumentAssignees(
  input: DocumentAssignInput
): Promise<string[]> {
  if (input.mode === "ALL") {
    const users = await db.user.findMany({
      where: {
        role: { in: [...DOCUMENT_ASSIGNABLE_ROLES] },
        deletedAt: null,
        isActive: true,
      },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  if (input.mode === "ROLES") {
    // Drop anything that isn't a staff role, so a hand-crafted request can't
    // smuggle CLIENT in through the roles array.
    const roles = (input.roles ?? []).filter(isAssignableRole);
    if (roles.length === 0) return [];
    const users = await db.user.findMany({
      where: { role: { in: roles }, deletedAt: null, isActive: true },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  if (input.mode === "USERS") {
    const ids = input.userIds ?? [];
    if (ids.length === 0) return [];
    const users = await db.user.findMany({
      where: {
        id: { in: ids },
        role: { in: [...DOCUMENT_ASSIGNABLE_ROLES] },
        deletedAt: null,
      },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  return [];
}
