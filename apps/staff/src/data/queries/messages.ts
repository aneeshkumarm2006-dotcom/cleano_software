// Office chat and team chat.
//
// No websockets in v1: a conversation on screen polls (refetchInterval) while
// the screen is focused and the app is in the foreground, and stops otherwise.
// Callers pass `live` for that; see features/messages/use-live.ts.
import type { OfficeMessagesResponse, TeamMessagesResponse } from "@bookmops/api/v1";
import { type InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useSource } from "../session";
import { keys } from "./jobs";

/** How often an open conversation asks for new messages. */
export const THREAD_POLL_MS = 5_000;
/** How often the channel list refreshes its unread counts while open. */
export const CHANNELS_POLL_MS = 15_000;

export const messageKeys = {
  // No key is a prefix of another, so invalidating a header never also
  // throws away (and refetches) the conversation under it.
  office: ["chat", "office", "summary"] as const,
  officeMessages: ["chat", "office", "messages"] as const,
  teamChannels: ["team", "channels"] as const,
  teamChannel: (channelId: string) => ["team", "channel", channelId, "summary"] as const,
  teamMessages: (channelId: string) => ["team", "channel", channelId, "messages"] as const,
  directory: ["team", "directory"] as const,
};

export type OfficePages = InfiniteData<OfficeMessagesResponse, string | null>;
export type TeamPages = InfiniteData<TeamMessagesResponse, string | null>;

// ---- The office ---------------------------------------------------------------

export function useOfficeChat(live: boolean) {
  const source = useSource();
  return useQuery({
    queryKey: messageKeys.office,
    queryFn: () => source.officeChat(),
    refetchInterval: live ? CHANNELS_POLL_MS : false,
  });
}

export function useOfficeMessages(live: boolean) {
  const source = useSource();
  return useInfiniteQuery({
    queryKey: messageKeys.officeMessages,
    queryFn: ({ pageParam }) => source.officeMessages(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: live ? THREAD_POLL_MS : false,
  });
}

/** Clear the office's unread count, here and on Today. */
export function useMarkOfficeRead() {
  const source = useSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => source.markOfficeRead(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.today });
      void qc.invalidateQueries({ queryKey: messageKeys.office, exact: true });
    },
  });
}

// ---- The team -------------------------------------------------------------------

export function useTeamChannels(live = false) {
  const source = useSource();
  return useQuery({
    queryKey: messageKeys.teamChannels,
    queryFn: () => source.teamChannels(),
    refetchInterval: live ? CHANNELS_POLL_MS : false,
  });
}

export function useTeamChannel(channelId: string) {
  const source = useSource();
  const qc = useQueryClient();
  return useQuery({
    queryKey: messageKeys.teamChannel(channelId),
    queryFn: () => source.teamChannel(channelId),
    // Opened from the list: show its name at once rather than a spinner.
    placeholderData: () =>
      qc.getQueryData<Awaited<ReturnType<typeof source.teamChannels>>>(messageKeys.teamChannels)?.items.find(
        (c) => c.id === channelId,
      ),
  });
}

export function useTeamMessages(channelId: string, live: boolean) {
  const source = useSource();
  return useInfiniteQuery({
    queryKey: messageKeys.teamMessages(channelId),
    queryFn: ({ pageParam }) => source.teamMessages(channelId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: live ? THREAD_POLL_MS : false,
  });
}

/** Move this person's read cursor for a channel, and refresh the badges. */
export function useMarkChannelRead(channelId: string) {
  const source = useSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => source.markChannelRead(channelId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: messageKeys.teamChannels }),
  });
}

export function useTeamDirectory() {
  const source = useSource();
  return useQuery({ queryKey: messageKeys.directory, queryFn: () => source.teamDirectory() });
}

/** Open (or start) a direct conversation. Safe to repeat: the server finds the existing one. */
export function useOpenDirect() {
  const source = useSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => source.openDirect({ userId }),
    onSuccess: (channel) => {
      qc.setQueryData(messageKeys.teamChannel(channel.id), channel);
      void qc.invalidateQueries({ queryKey: messageKeys.teamChannels });
    },
  });
}
