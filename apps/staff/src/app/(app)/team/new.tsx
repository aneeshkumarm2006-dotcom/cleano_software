import { ApiError } from "@bookmops/api/client";
import type { DirectoryEntry } from "@bookmops/api/v1";
import { color, Icon, minTouch, radius, space, Text, TextField } from "@bookmops/ui-native";
import { router } from "expo-router";
import { Fragment, useState } from "react";
import { ActivityIndicator, Alert, type AccessibilityActionEvent, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Empty, LoadError, Loading } from "@/components/QueryState";
import { useOpenDirect, useSetBlocked, useTeamBlocks, useTeamDirectory } from "@/data/queries";
import { Avatar } from "@/features/messages/MessageBubble";
import { BackHeader } from "@/features/record/ui";

/**
 * Start a direct message with a teammate. The list comes from the server,
 * which leaves it empty when the company has turned direct messages off, and
 * includes phone and email only when the company chose to share them.
 * Someone the person blocked is marked, and tapping them offers Unblock;
 * holding anyone else offers Block.
 */
export default function NewDirectMessage() {
  const insets = useSafeAreaInsets();
  const directory = useTeamDirectory();
  const open = useOpenDirect();
  const blocks = useTeamBlocks();
  const setBlocked = useSetBlocked();
  const blockedIds = new Set(blocks.data?.items.map((b) => b.id) ?? []);
  const [query, setQuery] = useState("");
  const [opening, setOpening] = useState<string | null>(null);

  const people = directory.data?.items ?? [];
  const q = query.trim().toLocaleLowerCase("en-CA");
  const shown = q ? people.filter((p) => p.name.toLocaleLowerCase("en-CA").includes(q)) : people;

  function changeBlock(person: DirectoryEntry, blocked: boolean) {
    const verb = blocked ? "Block" : "Unblock";
    Alert.alert(
      `${verb} ${person.name}?`,
      blocked
        ? "You won't see their messages in team chat, and neither of you can send the other a direct message. They won't be told."
        : "You'll see their messages in team chat again, and you can message each other.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: verb,
          style: blocked ? "destructive" : "default",
          onPress: () =>
            setBlocked.mutate(
              { userId: person.id, blocked },
              {
                onError: (e) =>
                  Alert.alert(`Couldn't ${verb.toLowerCase()} ${person.name}`, e instanceof ApiError ? e.message : "Check your connection and try again."),
              },
            ),
        },
      ],
    );
  }

  function start(person: DirectoryEntry) {
    if (blockedIds.has(person.id)) return changeBlock(person, false);
    if (opening) return;
    setOpening(person.id);
    open.mutate(person.id, {
      onSuccess: (channel) => router.replace({ pathname: "/team/[channelId]", params: { channelId: channel.id } }),
      onError: (e) =>
        Alert.alert(
          "Couldn't open the conversation",
          e instanceof ApiError ? e.message : "Check your connection and try again.",
        ),
      onSettled: () => setOpening(null),
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: color.ground }}>
      <BackHeader safeTop title="New message" fallback="/team" />

      <ScrollView
        contentContainerStyle={{ padding: space[4], paddingTop: space[2], gap: space[4], paddingBottom: insets.bottom + space[8] }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {directory.isPending ? (
          <Loading label="Loading your team" />
        ) : directory.isError ? (
          <LoadError error={directory.error} onRetry={() => directory.refetch()} />
        ) : !directory.data.dmEnabled ? (
          <Empty icon="team" title="Direct messages are off" detail="Your company has turned them off. You can still post in your team channels." />
        ) : people.length === 0 ? (
          <Empty icon="team" title="No teammates yet" detail="When other cleaners join, you can message them here." />
        ) : (
          <>
            <TextField
              label="Find a teammate"
              value={query}
              onChangeText={setQuery}
              placeholder="Name"
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="search"
            />
            {shown.length === 0 ? (
              <Text variant="body" color="ink2" align="center" style={{ paddingVertical: space[6] }}>
                Nobody on the team matches "{query.trim()}".
              </Text>
            ) : (
              <View style={{ backgroundColor: color.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, overflow: "hidden" }}>
                {shown.map((p, i) => (
                  <Fragment key={p.id}>
                    {i > 0 ? <View style={{ height: 1, backgroundColor: color.line, marginLeft: 68 }} /> : null}
                    <PersonRow
                      person={p}
                      blocked={blockedIds.has(p.id)}
                      busy={opening === p.id}
                      disabled={!!opening}
                      onPress={() => start(p)}
                      onBlock={() => changeBlock(p, !blockedIds.has(p.id))}
                    />
                  </Fragment>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function PersonRow({
  person,
  blocked,
  busy,
  disabled,
  onPress,
  onBlock,
}: {
  person: DirectoryEntry;
  blocked: boolean;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
  /** Block them, or unblock them when `blocked`. */
  onBlock: () => void;
}) {
  const contact = blocked ? "Blocked" : [person.phone, person.email].filter(Boolean).join(" · ");
  const blockAction = blocked ? `Unblock ${person.name}` : `Block ${person.name}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={blocked ? `${person.name}, blocked. Unblock` : `Message ${person.name}`}
      accessibilityHint={blocked ? undefined : "Hold to block"}
      accessibilityState={{ disabled, busy }}
      accessibilityActions={[{ name: "block", label: blockAction }]}
      onAccessibilityAction={(e: AccessibilityActionEvent) => {
        if (e.nativeEvent.actionName === "block") onBlock();
      }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onBlock}
      style={({ pressed }) => ({
        minHeight: minTouch + 16,
        flexDirection: "row",
        alignItems: "center",
        gap: space[3],
        paddingHorizontal: space[4],
        paddingVertical: space[3],
        backgroundColor: pressed ? color.groundDeep : color.surface,
      })}
    >
      <Avatar name={person.name} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {person.name}
        </Text>
        {contact ? (
          <Text variant="small" color="ink2" numberOfLines={1} selectable={!blocked}>
            {contact}
          </Text>
        ) : null}
      </View>
      {busy ? (
        <ActivityIndicator color={color.accent} />
      ) : (
        <Icon name={blocked ? "eyeOff" : "chat"} size={20} color={blocked ? "ink3" : "accentText"} />
      )}
    </Pressable>
  );
}
