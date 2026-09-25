import { Redirect, Stack } from "expo-router";

import { useStaffRole } from "@/data/role";

/**
 * The cleaner app: every screen a cleaner or a field lead works from. An
 * office role (OPS_MANAGER, ADMIN, OWNER) never sees these; it is sent to the
 * manager app instead, from here, so no cleaner screen needs its own check.
 */
export default function CrewLayout() {
  const { side } = useStaffRole();
  if (side === "office") return <Redirect href="/manage" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
