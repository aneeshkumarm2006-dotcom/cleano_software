import { type Announcement, MARK_READ_MAX } from "@bookmops/api/v1";
import { Button, color, space } from "@bookmops/ui-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Empty, LoadError, Loading } from "@/components/QueryState";
import { useAnnouncements, useMarkAnnouncementsRead, useMe } from "@/data/queries";
import { AnnouncementCard } from "@/features/announcements/AnnouncementCard";
import { useLive } from "@/features/messages/use-live";
import { BackHeader } from "@/features/record/ui";

/**
 * How long an announcement is on screen before it counts as seen. The web's
 * rule: a card that flashes past during a refresh hasn't been read, and the
 * office must not be told it has.
 */
const SEEN_AFTER_MS = 1500;

/** The office's noticeboard: pinned first, then newest. */
export default function Announcements() {
  const insets = useSafeAreaInsets();
  const me = useMe();
  const live = useLive();
  const list = useAnnouncements();
  const markRead = useMarkAnnouncementsRead();
  const tz = me.data?.company.timezone;

  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);

  // "New" stays on what was unread when the person arrived, for as long as
  // they're here, even though it's marked read in the meantime.
  const [arrivedUnread, setArrivedUnread] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const unread = items.filter((a) => !a.readByMe).map((a) => a.id);
    if (unread.some((id) => !arrivedUnread.has(id))) setArrivedUnread((s) => new Set([...s, ...unread]));
  }, [items, arrivedUnread]);

  // Mark what has been on screen as seen: unread ones, and ones read before
  // their last edit (re-stamped so the office's register catches up). Each id
  // is sent once per visit; a failure lets it be tried again.
  const sent = useRef(new Set<string>());
  const { mutate: mark } = markRead;
  useEffect(() => {
    if (!live) return;
    const due = items.filter((a) => (!a.readByMe || a.myReadStale) && !sent.current.has(a.id)).map((a) => a.id);
    if (due.length === 0) return;
    const t = setTimeout(() => {
      // The endpoint takes 200 at a time. Only what is actually sent counts
      // as sent; the rest go when the list refreshes after this batch.
      const batch = due.slice(0, MARK_READ_MAX);
      for (const id of batch) sent.current.add(id);
      mark(batch, {
        onError: () => {
          for (const id of batch) sent.current.delete(id);
        },
      });
    }, SEEN_AFTER_MS);
    return () => clearTimeout(t);
  }, [live, items, mark]);

  const header = <BackHeader safeTop title="Announcements" fallback="/" />;

  let body;
  if (list.isPending || (!tz && !me.isError)) {
    body = <Loading label="Loading announcements" />;
  } else if ((list.isError && items.length === 0) || me.isError || !tz) {
    body = (
      <View style={{ padding: space[4] }}>
        <LoadError
          error={list.error ?? me.error}
          onRetry={() => {
            void me.refetch();
            void list.refetch();
          }}
        />
      </View>
    );
  } else if (items.length === 0) {
    body = <Empty icon="announcements" title="No announcements yet" detail="News from the office will show up here." />;
  } else {
    body = (
      <FlatList<Announcement>
        data={items}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) => <AnnouncementCard item={item} isNew={arrivedUnread.has(item.id) || !item.readByMe} timeZone={tz} />}
        ItemSeparatorComponent={Gap}
        contentContainerStyle={{ paddingHorizontal: space[4], paddingTop: space[2], paddingBottom: insets.bottom + space[8] }}
        refreshControl={
          <RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => list.refetch()} tintColor={color.accent} colors={[color.accent]} />
        }
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage && !list.isFetchNextPageError) void list.fetchNextPage();
        }}
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <ActivityIndicator color={color.accent} style={{ paddingVertical: space[4] }} accessibilityLabel="Loading older announcements" />
          ) : list.isFetchNextPageError ? (
            <View style={{ paddingTop: space[4] }}>
              <Button label="Load older announcements" variant="secondary" size="md" onPress={() => list.fetchNextPage()} />
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
      {body}
    </View>
  );
}

function Gap() {
  return <View style={{ height: space[3] }} />;
}
