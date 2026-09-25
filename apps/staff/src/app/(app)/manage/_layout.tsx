import { Redirect, Stack } from "expo-router";

import { useStaffRole } from "@/data/role";

/**
 * The manager screens. Office roles (OPS_MANAGER, ADMIN, OWNER) live here;
 * a field lead reaches the few the web lets them use from their More tab.
 * A role with no manager capability at all (a cleaner) is sent home, and
 * each screen below checks its own capability too.
 */
export default function ManageLayout() {
  const role = useStaffRole();
  if (!role.manages) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
