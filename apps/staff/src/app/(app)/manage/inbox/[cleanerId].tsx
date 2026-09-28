import type { OfficeMessage, SendMessageRequest } from "@bookmops/api/v1";
import { color, space } from "@bookmops/ui-native";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo } from "react";
import { View } from "react-native";

import { Guarded } from "@/components/Guarded";
import { LoadError, Loading } from "@/components/QueryState";
import { managerKeys, useConversationMessages, useMarkConversationRead, useMe, useOfficeConversation } from "@/data/queries";
import { useSource } from "@/data/session";
import { Avatar } from "@/features/messages/MessageBubble";
import { ThreadHeader } from "@/features/messages/ThreadHeader";
import { ThreadView } from "@/features/messages/ThreadView";
import type { MessageStatus, ThreadMessage } from "@/features/messages/thread";
import { useChatIdentity, useConversation } from "@/features/messages/use-conversation";
import { useLive } from "@/features/messages/use-live";
import { useThreadSender } from "@/features/messages/use-send";
import { useNow } from "@/lib/use-now";

const RECEIPT: Record<string, MessageStatus> = { SENT: "sent", DELIVERED: "delivered", READ: "read" };

/** Read from the office's side: the office's messages, whoever sent them, sit on the right. */
function toMessage(m: OfficeMessage): ThreadMessage {
  return {
    key: m.id,
    mine: m.fromMe,
    senderKey: m.fromMe ? `office:${m.senderName}` : "cleaner",
    senderName: m.senderName,
    body: m.body,
    createdAt: m.createdAt,
    attachment: m.attachment,
    status: m.fromMe ? (RECEIPT[m.receipt] ?? "sent") : null,
  };
}

/**
 * One cleaner's conversation with the office, answered as the office (as
 * the web's admin chat). Polls while open, and marks the cleaner's messages
 * read for the office when it opens and as new ones arrive.
 */
export default function OfficeConversationScreen() {
  return (
    <Guarded need="OFFICE_INBOX">
      <Conversation />
    </Guarded>
  );
}

function Conversation() {
  const { cleanerId } = useLocalSearchParams<{ cleanerId: string }>();
  const me = useMe();
  const live = useLive();
  const now = useNow();
  const source = useSource();
  const summary = useOfficeConversation(cleanerId);
  const list = useConversationMessages(cleanerId, live);
  const { mutate: markRead } = useMarkConversationRead(cleanerId);
  const company = me.data?.company;
  const who = useChatIdentity(me.data);
  const thread = `office-inbox:${cleanerId}`;

  const server = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const { messages, latestIncomingId } = useConversation({ me: who, thread, server, toMessage });
  const send = useCallback((req: SendMessageRequest) => source.replyAsOffice(cleanerId, req), [source, cleanerId]);
  const { sendNew, retry, discard } = useThreadSender({ owner: who?.owner ?? null, thread, queryKey: managerKeys.conversationMessages(cleanerId), send });

  const loaded = list.isSuccess;
  useEffect(() => {
    if (live && loaded) markRead();
  }, [live, loaded, latestIncomingId, markRead]);

  const c = summary.data;
  const header = (
    <ThreadHeader
      badge={<Avatar name={c?.cleaner.name ?? "?"} size={40} />}
      title={c?.cleaner.name ?? "Conversation"}
      subtitle={c ? (c.online ? "Online now" : "Replies are emailed if they're away") : null}
      online={c?.online}
      fallback="/manage/messages"
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
      namesAbove={false}
      placeholder={c ? `Reply to ${c.cleaner.name.split(" ")[0]}` : "Reply as the office"}
      empty={{ title: "No messages yet", detail: "Write to them here. They see it as a message from the office." }}
      onSend={sendNew}
      onRetry={retry}
      onDiscard={discard}
    />
  );
}
