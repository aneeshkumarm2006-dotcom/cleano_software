import { TabBarButton, TabBarShell } from "@bookmops/ui-native";
import { TabList, TabSlot, Tabs, TabTrigger } from "expo-router/ui";

import { useToday } from "@/data/queries";

/**
 * The five tabs. Headless tabs from expo-router: the router owns navigation
 * and focus, the floating capsule is ours (@bookmops/ui-native).
 */
export default function TabsLayout() {
  const today = useToday();
  const unread = today.data?.unread;

  return (
    <Tabs>
      <TabSlot />
      <TabList asChild>
        <TabBarShell>
          <TabTrigger name="today" href="/" asChild>
            <TabBarButton label="Today" icon="today" />
          </TabTrigger>
          <TabTrigger name="jobs" href="/jobs" asChild>
            <TabBarButton label="Jobs" icon="jobs" />
          </TabTrigger>
          <TabTrigger name="available" href="/available" asChild>
            <TabBarButton label="Available" icon="available" />
          </TabTrigger>
          <TabTrigger name="pay" href="/pay" asChild>
            <TabBarButton label="Pay" icon="pay" />
          </TabTrigger>
          <TabTrigger name="more" href="/more" asChild>
            <TabBarButton label="More" icon="more" count={unread ? unread.office : undefined} />
          </TabTrigger>
        </TabBarShell>
      </TabList>
    </Tabs>
  );
}
