import { TabBarButton, TabBarShell } from "@bookmops/ui-native";
import { Redirect } from "expo-router";
import { TabList, TabSlot, Tabs, TabTrigger } from "expo-router/ui";

import { useStaffRole } from "@/data/role";
import { useApprovalsCount } from "@/features/manage/Approvals";

/**
 * The manager app's tabs, in the same floating capsule as the cleaner's,
 * with More fifth. Only the office roles get this bar; a field lead keeps
 * the cleaner's tabs and finds their team under More.
 */
export default function ManagerTabs() {
  const role = useStaffRole();
  const approvals = useApprovalsCount();
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
          <TabTrigger name="more" href="/manage/more" asChild>
            <TabBarButton label="More" icon="more" />
          </TabTrigger>
        </TabBarShell>
      </TabList>
    </Tabs>
  );
}
