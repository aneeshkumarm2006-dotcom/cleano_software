import { ApiError } from "@bookmops/api/client";
import type { Announcement, ReactionKind } from "@bookmops/api/v1";
import { Card, color, Icon, minTouch, radius, space, Text } from "@bookmops/ui-native";
import { Alert, Pressable, View } from "react-native";

import { newReactionEventId, useSetReaction } from "@/data/queries";
import { shortDate } from "@/lib/format";

/** The web's three reactions, in its order. */
const REACTIONS: readonly { kind: ReactionKind; emoji: string; name: string }[] = [
  { kind: "THUMBS_UP", emoji: "👍", name: "Thumbs up" },
  { kind: "PARTY", emoji: "🎉", name: "Celebrate" },
  { kind: "HEART", emoji: "❤️", name: "Heart" },
];

/**
 * One announcement. Pinned ones are the solid chrome block — importance is
 * fill — and unread ones carry a "New" marker until the person leaves.
 */
export function AnnouncementCard({ item, isNew, timeZone }: { item: Announcement; isNew: boolean; timeZone: string }) {
  const pinned = item.pinned;
  const date = shortDate(item.createdAt, timeZone);

  return (
    <Card tone={pinned ? "active" : "quiet"} padding={4}>
      <View style={{ gap: space[2] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          {pinned ? (
            <>
              <Icon name="pin" size={15} color="warningOnChrome" />
              <Text variant="eyebrow" color="warningOnChrome" style={{ fontSize: 10.5 }}>
                Pinned
              </Text>
            </>
          ) : null}
          {isNew ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] + 2 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: pinned ? color.accentOnChrome : color.accent }} />
              <Text variant="eyebrow" color={pinned ? "onChrome" : "accentText"} style={{ fontSize: 10.5 }}>
                New
              </Text>
            </View>
          ) : null}
          <View style={{ flex: 1 }} />
          <Text variant="small" weight="semibold" color={pinned ? "onChrome3" : "ink3"} numeral>
            {date}
          </Text>
        </View>

        <Text variant="subheading" color={pinned ? "onChrome" : "ink"} accessibilityRole="header">
          {item.title}
        </Text>
        {/* Plain text from the office, rendered as text: never HTML. */}
        <Text variant="body" color={pinned ? "onChrome2" : "ink2"} selectable>
          {item.body}
        </Text>

        <View
          style={{
            marginTop: space[2],
            paddingTop: space[3],
            borderTopWidth: 1,
            borderTopColor: pinned ? color.lineOnChrome : color.line,
            gap: space[3],
          }}
        >
          <Text variant="small" color={pinned ? "onChrome3" : "ink3"}>
            {item.authorName}
            {item.editedAt ? ` · edited ${shortDate(item.editedAt, timeZone)}` : ""}
          </Text>
          <Reactions item={item} onChrome={pinned} />
        </View>
      </View>
    </Card>
  );
}

function Reactions({ item, onChrome }: { item: Announcement; onChrome: boolean }) {
  const react = useSetReaction();

  function tap(kind: ReactionKind) {
    const next = item.myReaction === kind ? null : kind;
    react.mutate(
      { id: item.id, kind: next, clientEventId: newReactionEventId() },
      {
        onError: (e) =>
          Alert.alert("Couldn't save your reaction", e instanceof ApiError ? e.message : "Check your connection and try again."),
      },
    );
  }

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
      {REACTIONS.map((r) => {
        const count = item.reactions.find((x) => x.kind === r.kind)?.count ?? 0;
        const selected = item.myReaction === r.kind;
        return (
          <Pressable
            key={r.kind}
            accessibilityRole="button"
            accessibilityLabel={`${r.name}, ${count} ${count === 1 ? "reaction" : "reactions"}`}
            accessibilityHint={selected ? "Removes your reaction" : "Adds your reaction"}
            accessibilityState={{ selected, disabled: react.isPending }}
            disabled={react.isPending}
            onPress={() => tap(r.kind)}
            style={({ pressed }) => ({
              minHeight: minTouch,
              minWidth: 60,
              paddingHorizontal: space[3],
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: space[1] + 2,
              borderRadius: radius.pill,
              borderWidth: 1,
              ...(onChrome
                ? {
                    backgroundColor: selected ? "rgba(255,255,255,0.22)" : pressed ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.08)",
                    borderColor: selected ? color.accentOnChrome : color.lineOnChrome,
                  }
                : {
                    backgroundColor: selected ? color.accentSoft : pressed ? color.groundDeep : color.surface,
                    borderColor: selected ? color.accent : color.line,
                  }),
            })}
          >
            <Text variant="body" style={{ fontSize: 16 }}>
              {r.emoji}
            </Text>
            {count > 0 ? (
              <Text variant="small" weight="bold" numeral color={onChrome ? "onChrome" : selected ? "accentText" : "ink2"}>
                {count}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
