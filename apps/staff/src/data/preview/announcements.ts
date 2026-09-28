// Sample announcements for development builds, held in memory so reading and
// reacting stick for the session. Never bundled into a release (./index.ts).
import { ApiError } from "@bookmops/api/client";
import type { Announcement, ReactionKind, ReactionState } from "@bookmops/api/v1";

import type { DataSource } from "../source";
import { delay } from "./delay";

function daysAgo(d: number): string {
  return new Date(Date.now() - d * 86_400_000).toISOString();
}

type Row = Omit<Announcement, "reactions" | "myReaction"> & {
  /** Other people's reactions, by kind. */
  others: Partial<Record<ReactionKind, number>>;
  mine: ReactionKind | null;
};

const rows: Row[] = [
  {
    id: "a1",
    title: "New chemical handling rules",
    body: "From 1 October, descaler and oven cleaner must be stored in the labelled caddy, never loose in the van. Read the full note before your next shift.",
    pinned: true,
    authorName: "Marie D.",
    createdAt: daysAgo(6),
    editedAt: null,
    readByMe: false,
    myReadStale: false,
    others: { THUMBS_UP: 9 },
    mine: null,
  },
  {
    id: "a2",
    title: "Winter hours start 1 November",
    body: "Last bookings move to 4:30 PM across Montréal. Update your availability if this affects your afternoons.",
    pinned: false,
    authorName: "Marie D.",
    createdAt: daysAgo(9),
    editedAt: null,
    readByMe: false,
    myReadStale: false,
    others: { THUMBS_UP: 4 },
    mine: null,
  },
  {
    id: "a3",
    title: "Referral bonus is now $75",
    body: "Refer a cleaner who stays past 30 days and the bonus lands in your next payout.",
    pinned: false,
    authorName: "Sofia M.",
    createdAt: daysAgo(16),
    editedAt: daysAgo(15),
    readByMe: true,
    myReadStale: false,
    others: { PARTY: 6, HEART: 2 },
    mine: "PARTY",
  },
  {
    id: "a4",
    title: "Labour Day weekend cover",
    body: "Thank you to everyone who picked up a shift. Every job was covered.",
    pinned: false,
    authorName: "Marie D.",
    createdAt: daysAgo(28),
    editedAt: null,
    readByMe: true,
    myReadStale: false,
    others: { HEART: 11, THUMBS_UP: 3 },
    mine: null,
  },
];

function reactionState(r: Row): ReactionState {
  const counts = new Map<ReactionKind, number>(Object.entries(r.others) as [ReactionKind, number][]);
  if (r.mine) counts.set(r.mine, (counts.get(r.mine) ?? 0) + 1);
  return {
    reactions: [...counts].filter(([, n]) => n > 0).map(([kind, count]) => ({ kind, count })),
    myReaction: r.mine,
  };
}

function toAnnouncement(row: Row): Announcement {
  const { others: _others, mine: _mine, ...rest } = row;
  return { ...rest, ...reactionState(row) };
}

const unread = () => rows.filter((r) => !r.readByMe).length;

export const previewAnnouncementsApi = {
  announcements: () => delay({ items: rows.map(toAnnouncement), nextCursor: null, unreadCount: unread() }),

  markAnnouncementsRead: ({ ids }) => {
    let marked = 0;
    for (const r of rows) {
      if (ids.includes(r.id) && !r.readByMe) {
        r.readByMe = true;
        marked++;
      }
    }
    return delay({ marked, unreadCount: unread() }, 150);
  },

  setAnnouncementReaction: (id, { kind }) => {
    const r = rows.find((x) => x.id === id);
    if (!r) return Promise.reject(new ApiError("This announcement isn't available.", 404, "NOT_FOUND", false));
    r.mine = kind;
    return delay(reactionState(r), 250);
  },
} satisfies Pick<DataSource, "announcements" | "markAnnouncementsRead" | "setAnnouncementReaction">;
