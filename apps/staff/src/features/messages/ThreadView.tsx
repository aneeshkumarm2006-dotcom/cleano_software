import { Button, color, Icon, radius, space, Text } from "@bookmops/ui-native";
import { type ReactNode, useMemo } from "react";
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Empty, LoadError, Loading } from "@/components/QueryState";

import { Composer } from "./Composer";
import { MessageBubble } from "./MessageBubble";
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
        <Composer placeholder={placeholder} onSend={onSend} bottomPadding={keyboard ? space[3] : insets.bottom + space[3]} />
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
        <Text variant="eyebrow" color="ink2" accessibilityRole="header" style={{ fontSize: 10, lineHeight: 13 }}>
          {label}
        </Text>
      </View>
    </View>
  );
}
