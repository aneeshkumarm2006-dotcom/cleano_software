import type { OfficeConversation } from "@bookmops/api/v1";
import { Card, color, CountBadge, Screen, space, TAB_BAR_HEIGHT, Text } from "@bookmops/ui-native";
import { router } from "expo-router";
import { View } from "react-native";

import { MenuGroup } from "@/components/MenuList";
import { Empty, LoadError, Loading } from "@/components/QueryState";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useAnnouncements, useMe, useOfficeInbox, useTeamChannels } from "@/data/queries";
import { useStaffRole } from "@/data/role";
import { MoreButton } from "@/features/manage/Approvals";
import { Avatar } from "@/features/messages/MessageBubble";
import { useLive } from "@/features/messages/use-live";
import { Notice, SectionTitle } from "@/features/record/ui";
import { dayMonth } from "@/lib/dates";
import { clockTime } from "@/lib/format";
import { useNow } from "@/lib/use-now";

/**
 * Messages for the office: team chat (every channel, with moderation, for
 * the roles the web lets moderate), announcements to read, and for owners
 * and admins every cleaner's conversation with the office, answered as the
 * office. Publishing an announcement stays on the web console.
 */
export default function ManagerMessages() {
  const role = useStaffRole();
  const live = useLive();
  const team = useTeamChannels(live);
  const announcements = useAnnouncements();
  const inbox = useOfficeInbox(live);
  const teamUnread = team.data?.items.reduce((sum, c) => sum + c.unreadCount, 0);

  return (
    <Screen header={<ScreenHeader title="Messages" />} bottomInset={TAB_BAR_HEIGHT} refreshing={inbox.isRefetching} onRefresh={() => void inbox.refetch()}>
      <MenuGroup
        title="Team"
        items={[
          { key: "team", label: "Team chat", icon: "team", count: teamUnread, onPress: () => router.push("/team") },
          {
            key: "announcements",
            label: "Announcements",
            icon: "announcements",
            count: announcements.data?.pages[0]?.unreadCount,
            onPress: () => router.push("/announcements"),
          },
        ]}
      />
      <Notice tone="neutral" icon="info">
        New announcements are published from the web console.
      </Notice>
      {role.can("OFFICE_INBOX") ? <Inbox query={inbox} /> : null}
    </Screen>
  );
}

function Inbox({ query }: { query: ReturnType<typeof useOfficeInbox> }) {
  const me = useMe();
  const now = useNow();
  const tz = me.data?.company.timezone;
  if (query.isPending || !tz) return <Loading label="Loading conversations" />;
  if (query.isError) return <LoadError error={query.error} onRetry={() => query.refetch()} />;
  const items = query.data.pages.flatMap((p) => p.items);
  return (
    <>
      <SectionTitle>Office chat</SectionTitle>
      {items.length === 0 ? (
        <Empty icon="chat" title="No conversations yet" />
      ) : (
        items.map((c) => <ConversationRow key={c.cleaner.id} c={c} timeZone={tz} now={now} />)
      )}
      <MoreButton query={query} />
    </>
  );
}

function ConversationRow({ c, timeZone, now }: { c: OfficeConversation; timeZone: string; now: Date }) {
  const when = c.last
    ? dayMonth(c.last.at, timeZone) === dayMonth(now.toISOString(), timeZone)
      ? clockTime(c.last.at, timeZone)
      : dayMonth(c.last.at, timeZone)
    : null;
  const preview = c.last ? `${c.last.fromOffice ? "You: " : ""}${c.last.body}` : "No messages yet";
  return (
    <Card
      padding={4}
      onPress={() => router.push({ pathname: "/manage/inbox/[cleanerId]", params: { cleanerId: c.cleaner.id } })}
      accessibilityLabel={`${c.cleaner.name}${c.online ? ", online" : ""}${c.unreadCount ? `, ${c.unreadCount} unread` : ""}. ${preview}`}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
        <View>
          <Avatar name={c.cleaner.name} size={40} />
          {c.online ? (
            <View style={{ position: "absolute", right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, backgroundColor: color.success, borderWidth: 2, borderColor: color.surface }} />
          ) : null}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <Text variant={c.unreadCount ? "bodyStrong" : "body"} style={{ flex: 1 }} numberOfLines={1}>
              {c.cleaner.name}
            </Text>
            {when ? (
              <Text variant="small" color="ink3" numeral>
                {when}
              </Text>
            ) : null}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <Text variant="small" color="ink2" numberOfLines={1} style={{ flex: 1 }}>
              {preview}
            </Text>
            {c.unreadCount ? <CountBadge count={c.unreadCount} ring={color.surface} /> : null}
          </View>
        </View>
      </View>
    </Card>
  );
}
