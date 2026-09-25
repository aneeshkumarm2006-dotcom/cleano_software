import { TabBarButton, TabBarShell } from "@bookmops/ui-native";
import { Redirect } from "expo-router";
import { TabList, TabSlot, Tabs, TabTrigger } from "expo-router/ui";

import { useOfficeInbox, useTeamChannels } from "@/data/queries";
import { useStaffRole } from "@/data/role";
import { useApprovalsCount } from "@/features/manage/Approvals";

/**
 * The manager app's tabs, Today (the team) · Schedule · Approvals ·
 * Messages · More, in the same floating capsule as the cleaner's, with More
 * fifth. Only the office roles get this bar; a field lead keeps the
 * cleaner's tabs and finds their team under More.
 */
export default function ManagerTabs() {
  const role = useStaffRole();
  const approvals = useApprovalsCount();
  const inbox = useOfficeInbox();
  const team = useTeamChannels();
  const messages = (inbox.data?.pages[0]?.unreadTotal ?? 0) + (team.data?.items.reduce((sum, c) => sum + c.unreadCount, 0) ?? 0);
  if (role.side !== "office") return <Redirect href={role.home} />;

  return (
    <Tabs>
      <TabSlot />
      <TabList asChild>
        <TabBarShell>
          <TabTrigger name="today" href="/manage" asChild>
            <TabBarButton label="Today" icon="today" />
          </TabTrigger>
          <TabTrigger name="schedule" href="/manage/schedule" asChild>
            <TabBarButton label="Schedule" icon="schedule" />
          </TabTrigger>
          <TabTrigger name="approvals" href="/manage/approvals" asChild>
            <TabBarButton label="Approvals" icon="approvals" count={approvals} />
          </TabTrigger>
          <TabTrigger name="messages" href="/manage/messages" asChild>
            <TabBarButton label="Messages" icon="messages" count={messages || undefined} />
          </TabTrigger>
          <TabTrigger name="more" href="/manage/more" asChild>
            <TabBarButton label="More" icon="more" />
          </TabTrigger>
        </TabBarShell>
      </TabList>
    </Tabs>
  );
}
