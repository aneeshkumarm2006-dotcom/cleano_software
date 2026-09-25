import type { TeamChannel } from "@bookmops/api/v1";
import { color, CountBadge, Icon, IconButton, minTouch, radius, space, Text } from "@bookmops/ui-native";
import { router } from "expo-router";
import { Fragment } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Empty, LoadError, Loading } from "@/components/QueryState";
import { useTeamChannels } from "@/data/queries";
import { Avatar } from "@/features/messages/MessageBubble";
import { useLive } from "@/features/messages/use-live";

const KIND_TEXT: Record<string, string> = {
  DEFAULT: "Everyone on the team",
  GROUP: "Group",
  DIRECT: "Direct message",
};

/** Team chat: the channels this cleaner is in, and their direct messages. */
export default function TeamChannels() {
  const insets = useSafeAreaInsets();
  const live = useLive();
  const channels = useTeamChannels(live);
  const items = channels.data?.items ?? [];
  const groups = items.filter((c) => c.kind !== "DIRECT");
  const direct = items.filter((c) => c.kind === "DIRECT");

  return (
    <View style={{ flex: 1, backgroundColor: color.ground }}>
      <View style={{ paddingTop: insets.top + space[2], paddingHorizontal: space[4], paddingBottom: space[3], flexDirection: "row", alignItems: "center", gap: space[3] }}>
        <IconButton icon="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
        <Text variant="title" accessibilityRole="header" style={{ flex: 1 }} numberOfLines={1}>
          Team chat
        </Text>
        {channels.data?.dmEnabled ? (
          <IconButton icon="compose" label="New message to a teammate" tone="chrome" onPress={() => router.push("/team/new")} />
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: space[4], paddingTop: space[2], gap: space[5], paddingBottom: insets.bottom + space[8] }}
        refreshControl={
          <RefreshControl refreshing={channels.isRefetching} onRefresh={() => channels.refetch()} tintColor={color.accent} colors={[color.accent]} />
        }
      >
        {channels.isPending ? (
          <Loading label="Loading team chat" />
        ) : channels.isError && items.length === 0 ? (
          <LoadError error={channels.error} onRetry={() => channels.refetch()} />
        ) : items.length === 0 ? (
          <Empty icon="team" title="No conversations yet" detail="When the office adds you to a team channel, it shows up here." />
        ) : (
          <>
            {groups.length > 0 ? <ChannelGroup title="Channels" channels={groups} /> : null}
            {direct.length > 0 ? <ChannelGroup title="Direct messages" channels={direct} /> : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ChannelGroup({ title, channels }: { title: string; channels: readonly TeamChannel[] }) {
  return (
    <View style={{ gap: space[2] }}>
      <Text variant="eyebrow" color="ink3" accessibilityRole="header" style={{ paddingLeft: space[1] }}>
        {title}
      </Text>
      <View style={{ backgroundColor: color.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, overflow: "hidden" }}>
        {channels.map((c, i) => (
          <Fragment key={c.id}>
            {i > 0 ? <View style={{ height: 1, backgroundColor: color.line, marginLeft: 68 }} /> : null}
            <ChannelRow channel={c} />
          </Fragment>
        ))}
      </View>
    </View>
  );
}

function ChannelRow({ channel }: { channel: TeamChannel }) {
  const unread = channel.unreadCount > 0;
  const kind = KIND_TEXT[channel.kind] ?? "Conversation";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${channel.name}, ${kind}${unread ? `, ${channel.unreadCount} unread` : ""}`}
      onPress={() => router.push({ pathname: "/team/[channelId]", params: { channelId: channel.id } })}
      style={({ pressed }) => ({
        minHeight: minTouch + 20,
        flexDirection: "row",
        alignItems: "center",
        gap: space[3],
        paddingHorizontal: space[4],
        paddingVertical: space[3],
        // Unread is a wash of fill, never a stripe.
        backgroundColor: pressed ? color.groundDeep : unread ? color.accentSofter : color.surface,
      })}
    >
      {channel.kind === "DIRECT" ? (
        <Avatar name={channel.name} size={40} />
      ) : (
        <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: color.accentSoft, alignItems: "center", justifyContent: "center" }}>
          <Icon name="team" size={20} color="accentText" />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="bodyStrong" weight={unread ? "bold" : "semibold"} numberOfLines={1}>
          {channel.name}
        </Text>
        <Text variant="small" color="ink2" numberOfLines={1}>
          {kind}
        </Text>
      </View>
      {unread ? <CountBadge count={channel.unreadCount} ring={color.surface} /> : null}
      <Icon name="forward" size={18} color="ink3" />
    </Pressable>
  );
}
