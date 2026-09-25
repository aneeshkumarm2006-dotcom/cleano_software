import type { OfficeMessage } from "@bookmops/api/v1";
import { color, Icon, radius, space } from "@bookmops/ui-native";
import { useEffect, useMemo } from "react";
import { View } from "react-native";

import { LoadError, Loading } from "@/components/QueryState";
import { messageKeys, useMarkOfficeRead, useMe, useOfficeChat, useOfficeMessages } from "@/data/queries";
import { useSource } from "@/data/session";
import { ThreadHeader } from "@/features/messages/ThreadHeader";
import { ThreadView } from "@/features/messages/ThreadView";
import type { MessageStatus, ThreadMessage } from "@/features/messages/thread";
import { useConversation } from "@/features/messages/use-conversation";
import { useLive } from "@/features/messages/use-live";
import { useThreadSender } from "@/features/messages/use-send";
import { useNow } from "@/lib/use-now";

const RECEIPT: Record<string, MessageStatus> = { SENT: "sent", DELIVERED: "delivered", READ: "read" };

function toMessage(m: OfficeMessage): ThreadMessage {
  return {
    key: m.id,
    mine: m.fromMe,
    senderKey: m.fromMe ? "me" : `office:${m.senderName}`,
    senderName: m.senderName,
    body: m.body,
    createdAt: m.createdAt,
    attachment: m.attachment,
    // An unknown receipt from a newer server reads as plain "Sent".
    status: m.fromMe ? (RECEIPT[m.receipt] ?? "sent") : null,
  };
}

/**
 * The cleaner's one conversation with the office. Polls while on screen (no
 * websockets in v1) and marks the office's messages read when it opens and
 * as new ones arrive.
 */
export default function OfficeChat() {
  const me = useMe();
  const live = useLive();
  const now = useNow();
  const source = useSource();
  const chat = useOfficeChat(live);
  const list = useOfficeMessages(live);
  const markRead = useMarkOfficeRead();

  const person = me.data?.person;
  const company = me.data?.company;
  const who = useMemo(
    () => (person && company ? { id: person.id, name: person.name, owner: `${company.id}:${person.id}` } : null),
    [person, company],
  );

  const server = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const { messages, latestIncomingId } = useConversation({ me: who, thread: "office", server, toMessage });
  const { sendNew, retry, discard } = useThreadSender({
    owner: who?.owner ?? null,
    thread: "office",
    queryKey: messageKeys.officeMessages,
    send: source.sendOfficeMessage,
  });

  // Read on open, and again whenever something new from the office lands
  // while the conversation is on screen.
  const loaded = list.isSuccess;
  const { mutate: markReadNow } = markRead;
  useEffect(() => {
    if (live && loaded) markReadNow();
  }, [live, loaded, latestIncomingId, markReadNow]);

  const header = (
    <ThreadHeader
      badge={
        <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: color.chrome, alignItems: "center", justifyContent: "center" }}>
          <Icon name="chat" size={20} color="onChrome" />
        </View>
      }
      title={company?.name ?? "The office"}
      subtitle={chat.data ? (chat.data.officeOnline ? "Someone is online now" : "We'll reply as soon as we can") : null}
      online={chat.data?.officeOnline}
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
      placeholder="Message the office"
      empty={{ title: "No messages yet", detail: "Ask the office anything about your shifts. They'll reply here." }}
      onSend={sendNew}
      onRetry={retry}
      onDiscard={discard}
    />
  );
}
