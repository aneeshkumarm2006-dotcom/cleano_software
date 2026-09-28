// Who may switch off, archive, or demote whom.
//
// Switching someone off used to hide the cleaner app from them and nothing
// else. It now ends their sessions and refuses them new ones, which makes it a
// real lockout — and a lockout is only safe if it cannot be pointed the wrong
// way. Before this rule an operations manager could switch off the owner, an
// admin could switch off themselves, and the last owner could be archived,
// leaving a company that only Bookmops staff could let back in.
//
// Every path that takes someone's access away asks here first: the employee
// form, the bulk switch, delete, and bulk archive.
import "server-only";

import { db } from "@/lib/org-db";

export interface SwitchOffActor {
  id: string;
  role: string | null | undefined;
}

/**
 * Why taking access away from these people is not allowed, or null if it is.
 *
 * `targetIds` are the people losing access — switched off, archived, or (for
 * the owner rule) demoted away from OWNER. Ids that are not people in this
 * company are ignored, since nothing will happen to them either.
 */
export async function refuseUnsafeSwitchOff(
  actor: SwitchOffActor,
  targetIds: readonly string[],
): Promise<string | null> {
  if (targetIds.length === 0) return null;

  if (targetIds.includes(actor.id)) {
    return "You can't switch off, archive, or demote your own account. Ask another owner or admin.";
  }

  const owners = await db.user.findMany({
    where: { role: "OWNER", isActive: true, deletedAt: null },
    select: { id: true },
  });
  const ownerIds = new Set(owners.map((o) => o.id));
  const ownersAffected = targetIds.filter((id) => ownerIds.has(id));
  if (ownersAffected.length === 0) return null;

  if (actor.role !== "OWNER") {
    return "Only an owner can switch off, archive, or change the role of an owner.";
  }
  if (ownersAffected.length >= ownerIds.size) {
    return "That would leave the company with no active owner. Make someone else an owner first.";
  }
  return null;
}

/**
 * Only an owner can make someone an owner. An admin who could promote
 * themselves could then do everything the rule above keeps from them.
 */
export function refuseOwnerPromotion(
  actor: SwitchOffActor,
  newRole: string,
  previousRole: string | null | undefined,
): string | null {
  if (newRole === "OWNER" && previousRole !== "OWNER" && actor.role !== "OWNER") {
    return "Only an owner can make someone an owner.";
  }
  return null;
}
