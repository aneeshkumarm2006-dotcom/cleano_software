import type { TeamMessage } from "@bookmops/api/v1";
import { ApiError } from "@bookmops/api/client";
import { color, Icon, minTouch, radius, space, Text } from "@bookmops/ui-native";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";

import { LoadError, Loading } from "@/components/QueryState";
import { messageKeys, useMarkChannelRead, useMe, useSetBlocked, useTeamChannel, useTeamMessages } from "@/data/queries";
import { useStaffRole } from "@/data/role";
import { useSource } from "@/data/session";
import { Avatar } from "@/features/messages/MessageBubble";
import { ThreadHeader } from "@/features/messages/ThreadHeader";
import { type OthersMessages, type OwnMessages, ThreadView } from "@/features/messages/ThreadView";
import type { ThreadMessage } from "@/features/messages/thread";
import { useChatIdentity, useConversation } from "@/features/messages/use-conversation";
import { useLive } from "@/features/messages/use-live";
import { useOwnMessageEdits } from "@/features/messages/use-own-edits";
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
    body: m.deleted ? "" : m.body,
    createdAt: m.createdAt,
    attachment: null,
    // Team chat has no delivery receipts; the person's own show just the time.
    status: null,
    editedAt: m.editedAt,
    deleted: m.deleted,
    // The server decides in the end (only the sender, else 404); this only
    // decides what to offer.
    editableId: m.fromMe && !m.deleted ? m.id : undefined,
    // Offered only where the role may moderate (ThreadView's onModerate).
    removableId: !m.fromMe && !m.deleted ? m.id : undefined,
    // Anyone may report someone else's message and block its sender.
    reportableId: !m.fromMe && !m.deleted ? m.id : undefined,
  };
}

/**
 * One team channel or direct conversation. Who may read and post is the
 * server's call (the web's canAccessChannel): a channel this cleaner isn't in
 * answers "not found", and this screen shows that as an error with retry.
 * The person can edit and delete their own sent messages; unsent ones keep
 * Try again and Delete. Anyone else's message can be reported to the
 * office, and its sender blocked (App Store guideline 1.2); the server then
 * leaves their messages out, and this screen says some are hidden. An office
 * role that may moderate (OWNER, ADMIN, OPS_MANAGER, as the web's group chat)
 * can also remove anyone's message.
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
  const edits = useOwnMessageEdits(channelId, source);
  const { apply } = edits;
  const server = useMemo(() => apply(list.data?.pages.flatMap((p) => p.items) ?? []), [list.data, apply]);
  const { messages, latestIncomingId } = useConversation({ me: who, thread, server, toMessage });

  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = editingId ? (messages.find((m) => m.editableId === editingId) ?? null) : null;
  // Deleted meanwhile (from another phone, or by the office): the edit ends.
  if (editingId && !editing) setEditingId(null);

  const { edit, remove, moderate } = edits;
  const role = useStaffRole();
  const onModerate = useMemo(
    () => (role.can("TEAM_MODERATE") ? (m: ThreadMessage) => void (m.removableId && moderate(m.removableId)) : undefined),
    [role, moderate],
  );
  const own = useMemo<OwnMessages>(
    () => ({
      editing,
      startEdit: (m) => {
        if (m.editableId) setEditingId(m.editableId);
      },
      cancelEdit: () => setEditingId(null),
      saveEdit: (text) => {
        if (!editing?.editableId) return;
        setEditingId(null);
        if (text.trim() !== editing.body) void edit(editing.editableId, text);
      },
      remove: (m) => {
        if (!m.editableId) return;
        if (m.editableId === editingId) setEditingId(null);
        void remove(m.editableId);
      },
    }),
    [editing, editingId, edit, remove],
  );
  const setBlocked = useSetBlocked();
  const { mutate: block } = setBlocked;
  const others = useMemo<OthersMessages>(
    () => ({
      report: (m) => {
        if (!m.reportableId) return;
        router.push({ pathname: "/team/report", params: { messageId: m.reportableId, senderId: m.senderKey, name: m.senderName } });
      },
      block: (m) =>
        block(
          { userId: m.senderKey, blocked: true },
          {
            onError: (e) =>
              Alert.alert(`Couldn't block ${m.senderName}`, e instanceof ApiError ? e.message : "Check your connection and try again."),
          },
        ),
    }),
    [block],
  );
  const hidden = list.data?.pages.reduce((sum, p) => sum + p.hiddenCount, 0) ?? 0;

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
      own={own}
      onModerate={onModerate}
      others={others}
      notice={hidden > 0 ? <HiddenNotice /> : null}
    />
  );
}

/** Some messages here are from people the person blocked, and aren't shown. */
function HiddenNotice() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Messages from people you blocked are hidden. Opens Blocked people."
      onPress={() => router.push("/team/blocked")}
      style={({ pressed }) => ({
        minHeight: minTouch,
        flexDirection: "row",
        alignItems: "center",
        gap: space[2],
        paddingHorizontal: space[4],
        paddingVertical: space[2],
        backgroundColor: pressed ? color.groundDeep : color.accentSofter,
      })}
    >
      <Icon name="eyeOff" size={16} color="ink2" />
      <Text variant="small" color="ink2" style={{ flex: 1 }}>
        Messages from people you blocked are hidden.
      </Text>
      <Text variant="small" weight="semibold" color="accentText">
        Blocked people
      </Text>
    </Pressable>
  );
}
