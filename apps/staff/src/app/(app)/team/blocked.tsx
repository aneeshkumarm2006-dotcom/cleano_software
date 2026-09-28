import { ApiError } from "@bookmops/api/client";
import type { BlockedPerson } from "@bookmops/api/v1";
import { Button, color, radius, space, Text } from "@bookmops/ui-native";
import { Fragment, useState } from "react";
import { Alert, View } from "react-native";

import { Empty, LoadError, Loading } from "@/components/QueryState";
import { useMe, useSetBlocked, useTeamBlocks } from "@/data/queries";
import { Avatar } from "@/features/messages/MessageBubble";
import { BackHeader, Page } from "@/features/record/ui";
import { shortDate } from "@/lib/format";

/**
 * The people this person blocked in team chat, each with Unblock. Blocking is
 * done from a message (long press → Block); this is where it's undone.
 */
export default function BlockedPeople() {
  const me = useMe();
  const blocks = useTeamBlocks();
  const setBlocked = useSetBlocked();
  const [busy, setBusy] = useState<string | null>(null);
  const timeZone = me.data?.company.timezone;
  const items = blocks.data?.items ?? [];

  function unblock(person: BlockedPerson) {
    if (busy) return;
    setBusy(person.id);
    setBlocked.mutate(
      { userId: person.id, blocked: false },
      {
        onError: (e) => Alert.alert(`Couldn't unblock ${person.name}`, e instanceof ApiError ? e.message : "Check your connection and try again."),
        onSettled: () => setBusy(null),
      },
    );
  }

  return (
    <Page
      header={<BackHeader title="Blocked people" fallback="/team" />}
      refreshing={blocks.isRefetching}
      onRefresh={() => blocks.refetch()}
    >
      <Text variant="body" color="ink2">
        You don't see their messages in team chat, and neither of you can send the other a direct message. They aren't told.
      </Text>
      {blocks.isPending ? (
        <Loading label="Loading blocked people" />
      ) : blocks.isError ? (
        <LoadError error={blocks.error} onRetry={() => blocks.refetch()} />
      ) : items.length === 0 ? (
        <Empty icon="team" title="Nobody blocked" detail="To block someone, press and hold one of their messages in team chat." />
      ) : (
        <View style={{ backgroundColor: color.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, overflow: "hidden" }}>
          {items.map((p, i) => (
            <Fragment key={p.id}>
              {i > 0 ? <View style={{ height: 1, backgroundColor: color.line, marginLeft: 68 }} /> : null}
              <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3] }}>
                <Avatar name={p.name} size={40} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {p.name}
                  </Text>
                  {timeZone ? (
                    <Text variant="small" color="ink2">
                      {`Blocked ${shortDate(p.blockedAt, timeZone)}`}
                    </Text>
                  ) : null}
                </View>
                <Button
                  label="Unblock"
                  variant="secondary"
                  size="md"
                  loading={busy === p.id}
                  disabled={!!busy && busy !== p.id}
                  onPress={() => unblock(p)}
                  accessibilityLabel={`Unblock ${p.name}`}
                />
              </View>
            </Fragment>
          ))}
        </View>
      )}
    </Page>
  );
}
