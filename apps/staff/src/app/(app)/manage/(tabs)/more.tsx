import { Button, Screen, TAB_BAR_HEIGHT } from "@bookmops/ui-native";
import { router } from "expo-router";

import { MenuGroup, type MenuItem } from "@/components/MenuList";
import { ProfileCard } from "@/components/ProfileCard";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useStaffRole } from "@/data/role";
import { useSession } from "@/data/session";

const ROLE_NAME: Record<string, string> = { OWNER: "Owner", ADMIN: "Admin", OPS_MANAGER: "Manager" };

/**
 * The manager's More: the office's other queues, the account, and a pointer
 * to what stays on the web console.
 */
export default function ManagerMore() {
  const role = useStaffRole();
  const { signOut } = useSession();

  const office: MenuItem[] = [
    { key: "announcements", label: "Announcements", icon: "announcements", onPress: () => router.push("/announcements") },
  ];

  return (
    <Screen header={<ScreenHeader title="More" />} bottomInset={TAB_BAR_HEIGHT}>
      <ProfileCard detail={role.role ? ROLE_NAME[role.role] : undefined} />
      <MenuGroup title="Office" items={office} />
      <MenuGroup
        title="Account"
        items={[{ key: "password", label: "Change password", icon: "lock", onPress: () => router.push("/account/password") }]}
      />
      <Button label="Sign out" variant="danger" icon="signOut" onPress={signOut} />
    </Screen>
  );
}
