import type { ManagerCapability } from "@bookmops/api/v1";
import { Redirect } from "expo-router";
import type { ReactNode } from "react";

import { useStaffRole } from "@/data/role";

/**
 * A manager screen, shown only to a role that may use it (any one of `need`).
 * Anyone else is sent to their own app's start: the screen is not reachable,
 * whether from a link, a notification or a stale history entry. The server
 * refuses the same role with 403, so this is the experience, not the lock.
 */
export function Guarded({ need, children }: { need: ManagerCapability | readonly ManagerCapability[]; children: ReactNode }) {
  const role = useStaffRole();
  const needs = typeof need === "string" ? [need] : need;
  if (!needs.some((c) => role.can(c))) return <Redirect href={role.home} />;
  return children;
}
