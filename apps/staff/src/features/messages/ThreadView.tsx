import { Button, color, Icon, radius, space, Text } from "@bookmops/ui-native";
import * as Haptics from "expo-haptics";
import { type ReactNode, useMemo } from "react";
import { ActionSheetIOS, ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Empty, LoadError, Loading } from "@/components/QueryState";

import { Composer } from "./Composer";
import { MessageBubble, type OthersMessageActions, type OwnMessageActions } from "./MessageBubble";
import { buildRows, type ThreadMessage, type ThreadRow } from "./thread";
import { useKeyboardVisible } from "./use-live";

export interface ThreadQuery {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  fetchNextPage: () => unknown;
}

/** Team chat: changing the person's own sent messages. */
export interface OwnMessages {
  /** The message in the composer being edited, or null. */
  editing: ThreadMessage | null;
  startEdit: (message: ThreadMessage) => void;
  saveEdit: (text: string) => void;
  cancelEdit: () => void;
  remove: (message: ThreadMessage) => void;
}

/** Team chat: what the person can do about someone else's message. */
export interface OthersMessages {
  /** Opens the report form for this message. */
  report: (message: ThreadMessage) => void;
  /** Blocks its sender, once confirmed here. */
  block: (message: ThreadMessage) => void;
}

/**
 * A whole conversation below its header: the messages, newest at the bottom,
 * and the composer, which the keyboard never covers.
 *
 * Keyboard: `behavior="padding"` on BOTH platforms. Expo SDK 57 apps are
 * edge-to-edge on Android, so the window no longer resizes for the keyboard
 * (adjustResize has nothing to shrink) and the view has to make room itself,
 * exactly as on iOS. The composer drops its home-indicator padding while the
 * keyboard is up, so there's no gap between them.
 */
export function ThreadView({
  header,
  query,
  messages,
  timeZone,
  now,
  namesAbove,
  placeholder,
  empty,
  onSend,
  onRetry,
  onDiscard,
  own,
  onModerate,
  others,
  notice,
}: {
  header: ReactNode;
  query: ThreadQuery;
  /** Newest first, unsent ones included. */
  messages: readonly ThreadMessage[];
  timeZone: string;
  now: Date;
  /** Team chat: names over bubbles. Office chat: name beside the time. */
  namesAbove: boolean;
  placeholder: string;
  empty: { title: string; detail: string };
  onSend: (text: string) => boolean;
  onRetry: (pendingId: string) => void;
  onDiscard: (pendingId: string) => void;
  /** Team chat only. Office chat messages can't be edited or deleted. */
  own?: OwnMessages;
  /** Team chat, for a role that may moderate: remove someone else's message. */
  onModerate?: (message: ThreadMessage) => void;
  /** Team chat: report someone else's message, or block its sender. */
  others?: OthersMessages;
  /** A line under the header, e.g. that blocked people's messages are hidden. */
  notice?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardVisible();
  const rows = useMemo(() => buildRows(messages, timeZone, now, namesAbove), [messages, timeZone, now, namesAbove]);

  function onFailedPress(m: ThreadMessage) {
    const id = m.pendingId;
    if (!id) return;
    Alert.alert("Message not sent", m.error ?? undefined, [
      { text: "Delete", style: "destructive", onPress: () => onDiscard(id) },
      { text: "Cancel", style: "cancel" },
      { text: "Try again", onPress: () => onRetry(id) },
    ]);
  }

  const ownActions = useMemo<OwnMessageActions | undefined>(() => {
    if (!own) return undefined;
    const confirmDelete = (m: ThreadMessage) =>
      Alert.alert("Delete this message?", "Everyone in the conversation will see “Message deleted” in its place.", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => own.remove(m) },
      ]);
    return {
      onEdit: own.startEdit,
      onDelete: confirmDelete,
      onOptions: (m) => {
        void Haptics.selectionAsync().catch(() => {});
        if (Platform.OS === "ios") {
          ActionSheetIOS.showActionSheetWithOptions(
            { options: ["Edit", "Delete", "Cancel"], destructiveButtonIndex: 1, cancelButtonIndex: 2 },
            (i) => {
              if (i === 0) own.startEdit(m);
              else if (i === 1) confirmDelete(m);
            },
          );
        } else {
          Alert.alert(
            "Your message",
            undefined,
            [
              { text: "Cancel", style: "cancel" },
              { text: "Delete", style: "destructive", onPress: () => confirmDelete(m) },
              { text: "Edit", onPress: () => own.startEdit(m) },
            ],
            { cancelable: true },
          );
        }
      },
    };
  }, [own]);

  const othersActions = useMemo<OthersMessageActions | undefined>(() => {
    if (!onModerate && !others) return undefined;
    const confirmRemove = onModerate
      ? (m: ThreadMessage) =>
          Alert.alert("Remove this message?", `${m.senderName}'s message is replaced by “Message deleted” for everyone in the conversation.`, [
            { text: "Cancel", style: "cancel" },
            { text: "Remove", style: "destructive", onPress: () => onModerate(m) },
          ])
      : undefined;
    const confirmBlock = others
      ? (m: ThreadMessage) =>
          Alert.alert(
            `Block ${m.senderName}?`,
            "You won't see their messages in team chat, and neither of you can send the other a direct message. They won't be told. You can unblock them any time.",
            [
              { text: "Cancel", style: "cancel" },
              { text: "Block", style: "destructive", onPress: () => others.block(m) },
            ],
          )
      : undefined;
    return {
      onReport: others?.report,
      onBlock: confirmBlock,
      onRemove: confirmRemove,
      onOptions: (m) => {
        void Haptics.selectionAsync().catch(() => {});
        const choices: { label: string; destructive?: boolean; run: () => void }[] = [
          ...(others && m.reportableId ? [{ label: "Report message", run: () => others.report(m) }] : []),
          ...(confirmBlock && m.reportableId ? [{ label: `Block ${m.senderName}`, destructive: true, run: () => confirmBlock(m) }] : []),
          ...(confirmRemove && m.removableId ? [{ label: "Remove message", destructive: true, run: () => confirmRemove(m) }] : []),
        ];
        if (choices.length === 0) return;
        if (Platform.OS === "ios") {
          const destructive = choices.map((c, i) => (c.destructive ? i : -1)).filter((i) => i >= 0);
          ActionSheetIOS.showActionSheetWithOptions(
            { title: `${m.senderName}'s message`, options: [...choices.map((c) => c.label), "Cancel"], destructiveButtonIndex: destructive, cancelButtonIndex: choices.length },
            (i) => choices[i]?.run(),
          );
        } else {
          // Android shows at most three buttons; a tap outside cancels.
          Alert.alert(
            `${m.senderName}'s message`,
            undefined,
            choices.length < 3
              ? [{ text: "Cancel", style: "cancel" }, ...choices.map((c) => ({ text: c.label, onPress: c.run }))]
              : choices.map((c) => ({ text: c.label, onPress: c.run })),
            { cancelable: true },
          );
        }
      },
    };
  }, [onModerate, others]);

  // A refresh that fails while messages are already on screen keeps them,
  // and says so quietly; only a first load that fails takes the whole space.
  const staleBanner = query.isError && messages.length > 0;

  let body: ReactNode;
  if (query.isPending && messages.length === 0) {
    body = <Loading label="Loading messages" />;
  } else if (query.isError && messages.length === 0) {
    body = (
      <View style={{ padding: space[4] }}>
        <LoadError error={query.error} onRetry={() => query.refetch()} />
      </View>
    );
  } else if (rows.length === 0) {
    // Outside the list: an inverted list would draw its empty state upside down.
    body = <Empty icon="chat" title={empty.title} detail={empty.detail} />;
  } else {
    body = (
      <FlatList<ThreadRow>
        inverted
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={({ item }) =>
          item.type === "day" ? (
            <DayMarker label={item.label} />
          ) : (
            <MessageBubble
              message={item.message}
              showName={item.showName}
              namesAbove={namesAbove}
              timeZone={timeZone}
              onFailedPress={onFailedPress}
              own={ownActions}
              others={othersActions}
            />
          )
        }
        ItemSeparatorComponent={Gap}
        contentContainerStyle={{ paddingHorizontal: space[4], paddingVertical: space[4] }}
        // Drag the keyboard away on iOS; Android has no interactive mode.
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
        // Keep the reader's place when a message arrives while they're
        // scrolled back; follow new messages when they're at the bottom.
        maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 120 }}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError) query.fetchNextPage();
        }}
        // Drawn at the TOP, the list being inverted.
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <ActivityIndicator color={color.accent} style={{ paddingVertical: space[4] }} accessibilityLabel="Loading earlier messages" />
          ) : query.isFetchNextPageError ? (
            <View style={{ paddingVertical: space[3], alignItems: "center" }}>
              <Button label="Load earlier messages" variant="secondary" size="md" onPress={() => query.fetchNextPage()} />
            </View>
          ) : null
        }
        showsVerticalScrollIndicator={false}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: color.ground }}>
      {header}
      {notice}
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View style={{ flex: 1 }}>{body}</View>
        {staleBanner ? (
          <View
            accessibilityLiveRegion="polite"
            style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[4], paddingVertical: space[2], backgroundColor: color.warningSoft }}
          >
            <Icon name="warning" size={16} color="warning" />
            <Text variant="small" color="warning" style={{ flex: 1 }}>
              Can't reach the server. New messages will show when you're back online.
            </Text>
          </View>
        ) : null}
        <Composer
          placeholder={placeholder}
          onSend={onSend}
          bottomPadding={keyboard ? space[3] : insets.bottom + space[3]}
          editing={own?.editing ? { key: own.editing.key, body: own.editing.body } : null}
          onSaveEdit={own?.saveEdit}
          onCancelEdit={own?.cancelEdit}
        />
      </KeyboardAvoidingView>
    </View>
  );
}

function Gap() {
  return <View style={{ height: space[3] }} />;
}

function DayMarker({ label }: { label: string }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: space[1] }}>
      <View style={{ paddingHorizontal: space[3], paddingVertical: space[1] + 1, borderRadius: radius.pill, backgroundColor: color.groundDeep }}>
        <Text variant="eyebrow" color="ink2" accessibilityRole="header">
          {label}
        </Text>
      </View>
    </View>
  );
}
