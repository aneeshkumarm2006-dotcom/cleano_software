// Which side of Bookmops Pro the signed-in person gets, and what they may do
// on the manager side.
//
// The role comes from /me. It is also kept on the phone, so a manager who
// opens the app with no signal still lands on the manager screens rather
// than the cleaner ones. This is presentation only: every request is
// checked by the server against the same rules (@bookmops/api/v1
// manager-access.ts), and a screen a role can't use is simply not reachable.
import { appSideFor, can, capabilitiesFor, type ManagerCapability, teamScopeFor } from "@bookmops/api/v1";
import type { Href } from "expo-router";
import { useEffect, useMemo } from "react";

import { secureStorage } from "@/auth/secure-storage";

import { useMe } from "./queries/jobs";
import { useSession } from "./session";
import { onSignOut } from "./sign-out";

const KEY = "bookmopspro.role";

onSignOut(() => void secureStorage.removeItem(KEY).catch(() => undefined));

export interface StaffRole {
  /** The role, from /me or, until it answers, from the last time it did. Null when neither. */
  role: string | null;
  /** "crew" (EMPLOYEE, FIELD_LEAD), "office" (OPS_MANAGER, ADMIN, OWNER), or null for any other role. */
  side: ReturnType<typeof appSideFor>;
  /** Whose work the manager screens show, or null for a role with none. */
  scope: ReturnType<typeof teamScopeFor>;
  can: (capability: ManagerCapability) => boolean;
  /** Any manager screen at all: office roles and field leads. */
  manages: boolean;
  /** Where this role's app starts. */
  home: Href;
}

export function useStaffRole(): StaffRole {
  const me = useMe();
  const { session } = useSession();
  const live = session.status === "live";
  const fromServer = me.data?.person.role ?? null;

  const remembered = useMemo(() => (live ? secureStorage.getItem(KEY) : null), [live]);
  useEffect(() => {
    if (live && fromServer && fromServer !== remembered) secureStorage.setItem(KEY, fromServer);
  }, [live, fromServer, remembered]);

  const role = fromServer ?? remembered;
  return useMemo(() => {
    const side = appSideFor(role);
    return {
      role,
      side,
      scope: teamScopeFor(role),
      can: (capability: ManagerCapability) => can(role, capability),
      manages: capabilitiesFor(role).length > 0,
      home: side === "office" ? "/manage" : "/",
    };
  }, [role]);
}
