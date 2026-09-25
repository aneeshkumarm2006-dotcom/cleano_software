import { ApiError } from "@bookmops/api/client";
import type { DirectoryEntry } from "@bookmops/api/v1";
import { color, Icon, minTouch, radius, space, Text, TextField } from "@bookmops/ui-native";
import { router } from "expo-router";
import { Fragment, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Empty, LoadError, Loading } from "@/components/QueryState";
import { useOpenDirect, useTeamDirectory } from "@/data/queries";
import { Avatar } from "@/features/messages/MessageBubble";
import { BackHeader } from "@/features/record/ui";

/**
 * Start a direct message with a teammate. The list comes from the server,
 * which leaves it empty when the company has turned direct messages off, and
 * includes phone and email only when the company chose to share them.
 */
export default function NewDirectMessage() {
  const insets = useSafeAreaInsets();
  const directory = useTeamDirectory();
  const open = useOpenDirect();
  const [query, setQuery] = useState("");
  const [opening, setOpening] = useState<string | null>(null);

  const people = directory.data?.items ?? [];
  const q = query.trim().toLocaleLowerCase("en-CA");
  const shown = q ? people.filter((p) => p.name.toLocaleLowerCase("en-CA").includes(q)) : people;

  function start(person: DirectoryEntry) {
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
                    <PersonRow person={p} busy={opening === p.id} disabled={!!opening} onPress={() => start(p)} />
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

function PersonRow({ person, busy, disabled, onPress }: { person: DirectoryEntry; busy: boolean; disabled: boolean; onPress: () => void }) {
  const contact = [person.phone, person.email].filter(Boolean).join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Message ${person.name}`}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
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
          <Text variant="small" color="ink2" numberOfLines={1} selectable>
            {contact}
          </Text>
        ) : null}
      </View>
      {busy ? <ActivityIndicator color={color.accent} /> : <Icon name="chat" size={20} color="accentText" />}
    </Pressable>
  );
}
