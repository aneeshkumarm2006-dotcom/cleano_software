import type { MeResponse } from "@bookmops/api/v1";
import { useEffect, useMemo } from "react";

import { pendingStore, usePendingMessages } from "./pending";
import { pendingToMessage, type ThreadMessage } from "./thread";

interface ServerMessage {
  id: string;
  clientEventId: string | null;
  fromMe: boolean;
}

/** The person writing in a conversation, and who their unsent messages belong to. */
export interface ChatIdentity {
  id: string;
  name: string;
  /**
   * "company:person": who owns the unsent messages on this phone, so a second
   * person signing in on it never sees, or sends, the first person's.
   */
  owner: string;
}

/** The signed-in person as a conversation needs them; null until /me has loaded. */
export function useChatIdentity(me: MeResponse | undefined): ChatIdentity | null {
  const person = me?.person;
  const company = me?.company;
  return useMemo(
    () => (person && company ? { id: person.id, name: person.name, owner: `${company.id}:${person.id}` } : null),
    [person, company],
  );
}

/**
 * One conversation's messages as the screen shows them: what the server has,
 * newest first, with this person's unsent messages in front of it.
 *
 * A message the server turns out to have — its clientEventId shows up in a
 * poll, even though the answer to the send was lost — stops being "unsent"
 * and its local copy goes, so it's never shown twice or sent twice.
 */
export function useConversation<M extends ServerMessage>({
  me,
  thread,
  server,
  toMessage,
}: {
  me: ChatIdentity | null;
  thread: string;
  /** Every loaded page, flattened: newest first. */
  server: readonly M[];
  toMessage: (m: M) => ThreadMessage;
}) {
  const pending = usePendingMessages(me?.owner ?? null, thread);

  const confirmed = useMemo(() => {
    const s = new Set<string>();
    for (const m of server) if (m.clientEventId) s.add(m.clientEventId);
    return s;
  }, [server]);

  useEffect(() => {
    const done = pending.filter((p) => confirmed.has(p.id)).map((p) => p.id);
    if (done.length) pendingStore.remove(done);
  }, [pending, confirmed]);

  const messages = useMemo(() => {
    const unsent = me
      ? pending
          .filter((p) => !confirmed.has(p.id))
          .reverse()
          .map((p) => pendingToMessage(p, me))
      : [];
    return [...unsent, ...server.map(toMessage)];
  }, [me, pending, confirmed, server, toMessage]);

  /** The newest message from someone else: a change means there's something new to mark read. */
  const latestIncomingId = server.find((m) => !m.fromMe)?.id ?? null;

  return { messages, latestIncomingId };
}
