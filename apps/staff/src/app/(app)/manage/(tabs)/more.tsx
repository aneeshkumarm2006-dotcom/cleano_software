import { Button, Screen, TAB_BAR_HEIGHT } from "@bookmops/ui-native";
import { router } from "expo-router";

import { MenuGroup, type MenuItem } from "@/components/MenuList";
import { ProfileCard } from "@/components/ProfileCard";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useAlerts, useIssues } from "@/data/queries";
import { useStaffRole } from "@/data/role";
import { useSession } from "@/data/session";

const ROLE_NAME: Record<string, string> = { OWNER: "Owner", ADMIN: "Admin", OPS_MANAGER: "Manager" };

/**
 * The manager's More: alerts and problem reports, and the account.
 */
export default function ManagerMore() {
  const role = useStaffRole();
  const { signOut } = useSession();

  const alerts = useAlerts();
  const issues = useIssues("open");
  const office: MenuItem[] = [
    { key: "alerts", label: "Alerts", icon: "notifications", count: alerts.data?.pages[0]?.unreadCount, onPress: () => router.push("/manage/alerts") },
    ...(role.can("ISSUES")
      ? [
          {
            key: "problems",
            label: "Problem reports",
            icon: "warning" as const,
            status: issues.data?.pages[0]?.openCount ? `${issues.data.pages[0].openCount} open` : undefined,
            onPress: () => router.push({ pathname: "/manage/alerts", params: { show: "problems" } }),
          },
        ]
      : []),
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
