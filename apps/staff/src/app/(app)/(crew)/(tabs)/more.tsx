import { Button, Screen, TAB_BAR_HEIGHT } from "@bookmops/ui-native";
import { router } from "expo-router";

import { MenuGroup, type MenuItem } from "@/components/MenuList";
import { ProfileCard } from "@/components/ProfileCard";
import { ScreenHeader } from "@/components/ScreenHeader";
import {
  useAlerts,
  useAnnouncements,
  useApprovalsSummary,
  useDocuments,
  useKit,
  useTeamChannels,
  useToday,
  useTraining,
} from "@/data/queries";
import { useStaffRole } from "@/data/role";
import { useSession } from "@/data/session";
import { kitCounts } from "@/features/kit/display";

export default function More() {
  const today = useToday();
  const role = useStaffRole();
  const { signOut } = useSession();
  const teamChannels = useTeamChannels();
  const announcements = useAnnouncements();
  const teamUnread = teamChannels.data?.items.reduce((sum, c) => sum + c.unreadCount, 0);
  const announcementsUnread = announcements.data?.pages[0]?.unreadCount;
  const kit = useKit();
  const training = useTraining();
  const documents = useDocuments();
  const { low, tools } = kitCounts(kit.data);
  const toSign = documents.data?.items.filter((d) => d.status === "PENDING").length ?? 0;
  const trainingDone = training.data ? training.data.completed >= training.data.total : false;
  // A field lead's manager screens: only what the web lets a field lead do
  // (@bookmops/api/v1 manager-access.ts). A cleaner has none, so no group.
  const approvals = useApprovalsSummary();
  const alerts = useAlerts();
  const team: MenuItem[] = [
    ...(role.can("TEAM_VIEW")
      ? [{ key: "team", label: "Team today", icon: "team" as const, onPress: () => router.push("/manage/team") }]
      : []),
    ...(role.can("TIME_APPROVE")
      ? [{ key: "queue", label: "Approvals", icon: "approvals" as const, count: approvals.data?.time ?? undefined, onPress: () => router.push("/manage/queue") }]
      : []),
    ...(role.can("ALERTS")
      ? [{ key: "alerts", label: "Alerts", icon: "notifications" as const, count: alerts.data?.pages[0]?.unreadCount, onPress: () => router.push("/manage/alerts") }]
      : []),
  ];

  return (
    <Screen header={<ScreenHeader title="More" />} bottomInset={TAB_BAR_HEIGHT}>
      <ProfileCard detail={role.role === "FIELD_LEAD" ? "Field lead" : undefined} />

      {team.length > 0 ? <MenuGroup title="My team" items={team} /> : null}
      <MenuGroup
        title="My work"
        items={[
          {
            key: "kit",
            label: "My kit",
            icon: "kit",
            onPress: () => router.push("/kit"),
            status: low > 0 ? `${low} low` : tools > 0 ? `${tools} to fix` : undefined,
          },
          { key: "availability", label: "Availability", icon: "availability", onPress: () => router.push("/availability") },
          { key: "calendar", label: "Calendar", icon: "jobs", onPress: () => router.push("/calendar") },
        ]}
      />
      <MenuGroup
        title="Messages"
        items={[
          { key: "office", label: "Office chat", icon: "chat", count: today.data?.unread.office, onPress: () => router.push("/chat") },
          { key: "team", label: "Team chat", icon: "team", count: teamUnread, onPress: () => router.push("/team") },
          { key: "announcements", label: "Announcements", icon: "announcements", count: announcementsUnread, onPress: () => router.push("/announcements") },
        ]}
      />
      <MenuGroup
        title="My record"
        items={[
          {
            key: "training",
            label: "Training",
            icon: "training",
            onPress: () => router.push("/training"),
            status: training.data && training.data.total > 0 ? `${training.data.completed}/${training.data.total}` : undefined,
            statusTone: trainingDone ? "success" : "warning",
          },
          {
            key: "documents",
            label: "Documents",
            icon: "document",
            onPress: () => router.push("/documents"),
            status: toSign > 0 ? `${toSign} to sign` : undefined,
          },
          { key: "strikes", label: "My standing", icon: "standing", onPress: () => router.push("/strikes") },
        ]}
      />
      <MenuGroup
        title="Account"
        items={[
          { key: "password", label: "Change password", icon: "lock", onPress: () => router.push("/account/password") },
          { key: "delete", label: "Delete my account", icon: "trash", onPress: () => router.push("/account/delete") },
        ]}
      />

      <Button label="Sign out" variant="danger" icon="signOut" onPress={signOut} />
    </Screen>
  );
}
