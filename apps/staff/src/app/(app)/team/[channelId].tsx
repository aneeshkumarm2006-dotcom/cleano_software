import type { TeamMessage } from "@bookmops/api/v1";
import { color, Icon, radius, space } from "@bookmops/ui-native";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo } from "react";
import { View } from "react-native";

import { LoadError, Loading } from "@/components/QueryState";
import { messageKeys, useMarkChannelRead, useMe, useTeamChannel, useTeamMessages } from "@/data/queries";
import { useSource } from "@/data/session";
import { Avatar } from "@/features/messages/MessageBubble";
import { ThreadHeader } from "@/features/messages/ThreadHeader";
import { ThreadView } from "@/features/messages/ThreadView";
import type { ThreadMessage } from "@/features/messages/thread";
import { useChatIdentity, useConversation } from "@/features/messages/use-conversation";
import { useLive } from "@/features/messages/use-live";
import { useThreadSender } from "@/features/messages/use-send";
import { useNow } from "@/lib/use-now";

const KIND_TEXT: Record<string, string> = {
  DEFAULT: "Everyone on the team",
  GROUP: "Group",
  DIRECT: "Direct message",
};

function toMessage(m: TeamMessage): ThreadMessage {
  return {
    key: m.id,
    mine: m.fromMe,
    senderKey: m.senderId,
    senderName: m.senderName,
    body: m.body,
    createdAt: m.createdAt,
    attachment: null,
    // Team chat has no delivery receipts; the person's own show just the time.
    status: null,
  };
}

/**
 * One team channel or direct conversation. Who may read and post is the
 * server's call (the web's canAccessChannel): a channel this cleaner isn't in
 * answers "not found", and this screen shows that as an error with retry.
 */
export default function TeamConversation() {
  const { channelId } = useLocalSearchParams<{ channelId: string }>();
  const me = useMe();
  const live = useLive();
  const now = useNow();
  const source = useSource();
  const channel = useTeamChannel(channelId);
  const list = useTeamMessages(channelId, live);
  const { mutate: markRead } = useMarkChannelRead(channelId);

  const company = me.data?.company;
  const who = useChatIdentity(me.data);

  const thread = `team:${channelId}`;
  const server = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const { messages, latestIncomingId } = useConversation({ me: who, thread, server, toMessage });
  const send = useCallback((req: Parameters<typeof source.sendTeamMessage>[1]) => source.sendTeamMessage(channelId, req), [source, channelId]);
  const { sendNew, retry, discard } = useThreadSender({
    owner: who?.owner ?? null,
    thread,
    queryKey: messageKeys.teamMessages(channelId),
    send,
  });

  const loaded = list.isSuccess;
  useEffect(() => {
    if (live && loaded) markRead();
  }, [live, loaded, latestIncomingId, markRead]);

  const c = channel.data;
  const direct = c?.kind === "DIRECT";
  const header = (
    <ThreadHeader
      badge={
        c && direct ? (
          <Avatar name={c.name} size={40} />
        ) : (
          <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: color.accentSoft, alignItems: "center", justifyContent: "center" }}>
            <Icon name="team" size={20} color="accentText" />
          </View>
        )
      }
      title={c?.name ?? "Team chat"}
      subtitle={c ? (KIND_TEXT[c.kind] ?? null) : null}
    />
  );

  if (!company) {
    return (
      <View style={{ flex: 1, backgroundColor: color.ground }}>
        {header}
        {me.isError ? (
          <View style={{ padding: space[4] }}>
            <LoadError error={me.error} onRetry={() => me.refetch()} />
          </View>
        ) : (
          <Loading label="Loading messages" />
        )}
      </View>
    );
  }

  return (
    <ThreadView
      header={header}
      query={list}
      messages={messages}
      timeZone={company.timezone}
      now={now}
      namesAbove={!direct}
      placeholder={direct && c ? `Message ${c.name.split(" ")[0]}` : "Message the team"}
      empty={{
        title: "No messages yet",
        detail: direct ? "Say hello. The office can see direct messages too." : "Start the conversation. Everyone in this channel will see it.",
      }}
      onSend={sendNew}
      onRetry={retry}
      onDiscard={discard}
    />
  );
}
