// Sample office chat and team chat for development builds, held in memory so
// sending a message actually adds it and opening a conversation clears its
// unread count. Never bundled into a release (see ./index.ts).
//
// To see a failed send and its retry on a simulator, send a message containing
// "#fail": the first attempt fails as if the connection dropped, the retry
// (same clientEventId) goes through. An edit to text containing "#fail"
// always fails, to show it being rolled back.
import { ApiError } from "@bookmops/api/client";
import type {
  DirectoryEntry,
  OfficeMessage,
  SendMessageRequest,
  TeamChannel,
  TeamMessage,
} from "@bookmops/api/v1";

import type { DataSource } from "../source";
import { delay } from "./delay";

const ME = { id: "preview-cleaner", name: "Amara Diallo" };
const PAGE = 20;

function minutesAgo(m: number): string {
  return new Date(Date.now() - m * 60_000).toISOString();
}

/** Newest first, with an opaque cursor that is just the index to resume at. */
function pageOf<T>(newestFirst: readonly T[], cursor?: string | null) {
  const start = cursor ? Number(cursor) : 0;
  const items = newestFirst.slice(start, start + PAGE);
  const next = start + PAGE < newestFirst.length ? String(start + PAGE) : null;
  return { items, nextCursor: next };
}

/** A failed first attempt for "#fail" messages, once per clientEventId. */
const failedOnce = new Set<string>();
function maybeFail(req: SendMessageRequest) {
  if (req.body.includes("#fail") && !failedOnce.has(req.clientEventId)) {
    failedOnce.add(req.clientEventId);
    throw new ApiError("You're offline. We'll try again when you're back.", 0, "NETWORK", true);
  }
}

// ---- The office ---------------------------------------------------------------

type OfficeRow = OfficeMessage & { readByMe: boolean };

function office(minutes: number, body: string, over: Partial<OfficeRow> = {}): OfficeRow {
  return {
    id: `o-${minutes}`,
    clientEventId: null,
    fromMe: false,
    senderRole: "ADMIN",
    senderName: "Marie D.",
    body,
    attachment: null,
    createdAt: minutesAgo(minutes),
    receipt: "READ",
    readByMe: true,
    ...over,
  };
}

function mine(minutes: number, body: string, receipt: OfficeMessage["receipt"] = "READ"): OfficeRow {
  return office(minutes, body, { fromMe: true, senderRole: "EMPLOYEE", senderName: ME.name, receipt, id: `o-${minutes}-me` });
}

// Oldest first here, for reading; served newest first.
const officeRows: OfficeRow[] = [
  office(60 * 27, "Hi Amara, welcome to the team. Message us here any time during a shift."),
  mine(60 * 26.8, "Thanks Marie! Where do I pick up my kit?"),
  office(60 * 26.5, "At the Mile End office, any day from 8. Here are the lockbox instructions for the Saint-Denis flat.", {
    attachment: { kind: "FILE", url: "https://example.com/lockbox-instructions.pdf", name: "Lockbox instructions.pdf" },
  }),
  office(95, "Morning Amara. Claire at Saint-Denis asked if you can start 15 minutes early today."),
  mine(92, "That works. I can be there for 8:45."),
  office(89, "Perfect, I have told her. The lockbox code changed, it is 4821 now.", { readByMe: false }),
  office(12, "Parking is free on Duluth after 9 if you need it.", { readByMe: false }),
];

export const previewMessagesApi = {
  officeChat: () => delay({ officeOnline: true, unreadCount: officeRows.filter((m) => !m.readByMe).length }),

  officeMessages: (cursor) => delay(pageOf([...officeRows].reverse().map(({ readByMe: _r, ...m }) => m), cursor)),

  sendOfficeMessage: async (req) => {
    await delay(null, 500);
    // Idempotent, as the server is: a retry returns what the first attempt saved.
    const existing = officeRows.find((m) => m.clientEventId === req.clientEventId);
    if (existing) return existing;
    maybeFail(req);
    const row: OfficeRow = {
      ...mine(0, req.body.trim(), "DELIVERED"),
      id: `o-${req.clientEventId}`,
      clientEventId: req.clientEventId,
    };
    officeRows.push(row);
    const { readByMe: _r, ...message } = row;
    return message;
  },

  markOfficeRead: () => {
    for (const m of officeRows) m.readByMe = true;
    return delay({ unreadCount: 0 }, 150);
  },

  // ---- The team -------------------------------------------------------------

  teamChannels: () =>
    delay({
      items: channels.map((c) => ({ ...c, unreadCount: unreadIn(c.id) })),
      nextCursor: null,
      dmEnabled: true,
    }),

  teamChannel: (channelId) => {
    const c = channels.find((x) => x.id === channelId);
    if (!c) return Promise.reject(new ApiError("This conversation isn't available.", 404, "NOT_FOUND", false));
    return delay({ ...c, unreadCount: unreadIn(c.id) });
  },

  teamMessages: (channelId, cursor) => {
    if (!channels.some((c) => c.id === channelId)) {
      return Promise.reject(new ApiError("This conversation isn't available.", 404, "NOT_FOUND", false));
    }
    return delay(pageOf([...(teamRows.get(channelId) ?? [])].reverse(), cursor));
  },

  sendTeamMessage: async (channelId, req) => {
    await delay(null, 500);
    const rows = teamRows.get(channelId);
    if (!rows) throw new ApiError("This conversation isn't available.", 404, "NOT_FOUND", false);
    const existing = rows.find((m) => m.clientEventId === req.clientEventId);
    if (existing) return existing;
    maybeFail(req);
    const message: TeamMessage = {
      id: `t-${req.clientEventId}`,
      channelId,
      clientEventId: req.clientEventId,
      fromMe: true,
      senderId: ME.id,
      senderName: ME.name,
      body: req.body.trim(),
      createdAt: new Date().toISOString(),
      editedAt: null,
      deleted: false,
    };
    rows.push(message);
    readAt.set(channelId, Date.now());
    return message;
  },

  editTeamMessage: async (channelId, messageId, req) => {
    await delay(null, 500);
    const rows = teamRows.get(channelId);
    const i = rows?.findIndex((m) => m.id === messageId) ?? -1;
    // Only the sender's own message; anyone else's is "not found", as on the server.
    if (!rows || i < 0 || !rows[i]!.fromMe) throw new ApiError("This message isn't available.", 404, "NOT_FOUND", false);
    const edit = editsSeen.get(req.clientEventId);
    if (edit) return edit;
    if (rows[i]!.deleted) throw new ApiError("This message was deleted, so it can't be edited.", 409, "MESSAGE_DELETED", false);
    if (req.body.includes("#fail")) throw new ApiError("You're offline. We'll try again when you're back.", 0, "NETWORK", true);
    const updated: TeamMessage = { ...rows[i]!, body: req.body.trim(), editedAt: new Date().toISOString() };
    rows[i] = updated;
    editsSeen.set(req.clientEventId, updated);
    return updated;
  },

  deleteTeamMessage: async (channelId, messageId) => {
    await delay(null, 400);
    const rows = teamRows.get(channelId);
    const i = rows?.findIndex((m) => m.id === messageId) ?? -1;
    if (!rows || i < 0 || !rows[i]!.fromMe) throw new ApiError("This message isn't available.", 404, "NOT_FOUND", false);
    // Soft, and the same answer again for a message already deleted.
    rows[i] = { ...rows[i]!, body: "", deleted: true };
    return { id: messageId };
  },

  markChannelRead: (channelId) => {
    readAt.set(channelId, Date.now());
    return delay({ channelId }, 150);
  },

  teamDirectory: () => delay({ items: directory, nextCursor: null, dmEnabled: true, showContactInfo: false }),

  openDirect: async ({ userId }) => {
    await delay(null, 300);
    const person = directory.find((d) => d.id === userId);
    if (!person) throw new ApiError("That person isn't available.", 404, "NOT_FOUND", false);
    let channel = channels.find((c) => c.kind === "DIRECT" && dmWith.get(c.id) === userId);
    if (!channel) {
      channel = { id: `dm-${userId}`, name: person.name, kind: "DIRECT", unreadCount: 0 };
      channels.push(channel);
      dmWith.set(channel.id, userId);
      teamRows.set(channel.id, []);
    }
    return { ...channel, unreadCount: unreadIn(channel.id) };
  },
} satisfies Pick<
  DataSource,
  | "officeChat"
  | "officeMessages"
  | "sendOfficeMessage"
  | "markOfficeRead"
  | "teamChannels"
  | "teamChannel"
  | "teamMessages"
  | "sendTeamMessage"
  | "editTeamMessage"
  | "deleteTeamMessage"
  | "markChannelRead"
  | "teamDirectory"
  | "openDirect"
>;

// ---- Team data ----------------------------------------------------------------

const channels: TeamChannel[] = [
  { id: "ch-all", name: "Montréal crew", kind: "DEFAULT", unreadCount: 0 },
  { id: "ch-plateau", name: "Plateau team", kind: "GROUP", unreadCount: 0 },
  { id: "dm-lucie", name: "Lucie Paquette", kind: "DIRECT", unreadCount: 0 },
];
const dmWith = new Map<string, string>([["dm-lucie", "u-lucie"]]);

function team(channelId: string, minutes: number, who: { id: string; name: string }, body: string): TeamMessage {
  const fromMe = who.id === ME.id;
  return {
    id: `t-${channelId}-${minutes}`,
    channelId,
    clientEventId: null,
    fromMe,
    senderId: who.id,
    senderName: who.name,
    body,
    createdAt: minutesAgo(minutes),
    editedAt: null,
    deleted: false,
  };
}

/** Edits already applied, by clientEventId: a retry returns the same answer. */
const editsSeen = new Map<string, TeamMessage>();

const JEAN = { id: "u-jean", name: "Jean Morin" };
const LUCIE = { id: "u-lucie", name: "Lucie Paquette" };
const SOFIA = { id: "u-sofia", name: "Sofia Martins" };

const teamRows = new Map<string, TeamMessage[]>([
  [
    "ch-all",
    [
      team("ch-all", 60 * 24 + 40, SOFIA, "Reminder that the Mile End office is closed Monday for Thanksgiving."),
      team("ch-all", 60 * 24 + 20, JEAN, "Thanks Sofia. Enjoy the long weekend everyone."),
      team("ch-all", 58, JEAN, "Does anyone have a spare descaler? Mine ran out on Rachel Est."),
      team("ch-all", 55, LUCIE, "I have two in the van. I am on Duluth until 11, come by any time."),
      { ...team("ch-all", 53, SOFIA, ""), deleted: true },
      { ...team("ch-all", 51, ME, "Jean, I am at Saint-Denis until 12 and I have one spare too if Lucie runs out."), editedAt: minutesAgo(50) },
      team("ch-all", 49, JEAN, "Sorted, thank you both."),
    ],
  ],
  [
    "ch-plateau",
    [
      team("ch-plateau", 60 * 3, SOFIA, "Who is taking the 2 pm on Marie-Anne? The client asked for the same person as last time."),
      team("ch-plateau", 60 * 2.5, LUCIE, "That was me. I can do it."),
    ],
  ],
  ["dm-lucie", [team("dm-lucie", 60 * 5, LUCIE, "Thanks for covering Tuesday!")]],
]);

/** The phone's read cursor per channel. The DM starts read, the rest don't. */
const readAt = new Map<string, number>([
  ["ch-all", Date.now() - 57 * 60_000],
  ["dm-lucie", Date.now()],
]);

function unreadIn(channelId: string): number {
  const since = readAt.get(channelId) ?? 0;
  return (teamRows.get(channelId) ?? []).filter((m) => !m.fromMe && new Date(m.createdAt).getTime() > since).length;
}

const directory: DirectoryEntry[] = [
  { id: "u-jean", name: "Jean Morin", phone: null, email: null },
  { id: "u-lucie", name: "Lucie Paquette", phone: null, email: null },
  { id: "u-sofia", name: "Sofia Martins", phone: null, email: null },
  { id: "u-thomas", name: "Thomas Nguyen", phone: null, email: null },
];
