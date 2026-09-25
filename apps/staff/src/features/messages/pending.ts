// Messages the person has sent that the server hasn't confirmed yet.
//
// A message is written here the moment Send is tapped and shown at once, then
// removed when the server has it. If sending fails it stays, marked failed,
// with a way to try again — on this screen, after leaving it, and after the
// app is killed (SQLite, like the clock outbox). A retry reuses the message's
// clientEventId, so the server saves it once however many times it is sent.
//
// Rows are owned by company + person, so a second person signing in on the
// same phone never sees, or sends, the first person's unsent messages.
import * as SQLite from "expo-sqlite";
import { useSyncExternalStore } from "react";

export interface PendingMessage {
  /** The clientEventId: also the idempotency key. */
  id: string;
  owner: string;
  /** "office", or "team:<channelId>". */
  thread: string;
  body: string;
  createdAt: number;
  status: "sending" | "failed";
  /** Why it failed, in words for the person. */
  error: string | null;
}

type Raw = { id: string; owner: string; thread: string; body: string; created_at: number; status: string; error: string | null };

const NOT_SENT = "Not sent. Check your connection and try again.";

let db: SQLite.SQLiteDatabase | null = null;
function open(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync("messages-outbox.db");
    db.execSync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS pending_messages (
        id TEXT PRIMARY KEY NOT NULL,
        owner TEXT NOT NULL,
        thread TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'sending',
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS pending_messages_thread ON pending_messages (owner, thread, created_at);
    `);
    // Nothing is in flight in a process that has just started, so a row still
    // "sending" is one whose request died with the last run. Say so, and let
    // the person decide to send it again.
    db.runSync("UPDATE pending_messages SET status = 'failed', error = ? WHERE status = 'sending'", NOT_SENT);
  }
  return db;
}

// ---- A tiny external store over the table, for useSyncExternalStore --------

const listeners = new Set<() => void>();
const snapshots = new Map<string, readonly PendingMessage[]>();
const EMPTY: readonly PendingMessage[] = [];

function changed() {
  snapshots.clear();
  for (const l of listeners) l();
}

function read(owner: string, thread: string): readonly PendingMessage[] {
  const key = `${owner}\u0000${thread}`;
  let snap = snapshots.get(key);
  if (!snap) {
    const rows = open().getAllSync<Raw>(
      "SELECT * FROM pending_messages WHERE owner = ? AND thread = ? ORDER BY created_at, rowid",
      owner,
      thread,
    );
    snap = rows.length
      ? rows.map((r) => ({
          id: r.id,
          owner: r.owner,
          thread: r.thread,
          body: r.body,
          createdAt: r.created_at,
          status: r.status === "failed" ? "failed" : "sending",
          error: r.error,
        }))
      : EMPTY;
    snapshots.set(key, snap);
  }
  return snap;
}

export const pendingStore = {
  add(p: Omit<PendingMessage, "status" | "error">): void {
    open().runSync(
      "INSERT OR IGNORE INTO pending_messages (id, owner, thread, body, created_at) VALUES (?, ?, ?, ?, ?)",
      p.id,
      p.owner,
      p.thread,
      p.body,
      p.createdAt,
    );
    changed();
  },
  sending(id: string): void {
    open().runSync("UPDATE pending_messages SET status = 'sending', error = NULL WHERE id = ?", id);
    changed();
  },
  failed(id: string, error: string | null): void {
    open().runSync("UPDATE pending_messages SET status = 'failed', error = ? WHERE id = ?", error ?? NOT_SENT, id);
    changed();
  },
  remove(ids: readonly string[]): void {
    if (ids.length === 0) return;
    const db = open();
    for (const id of ids) db.runSync("DELETE FROM pending_messages WHERE id = ?", id);
    changed();
  },
  get(id: string): PendingMessage | null {
    const r = open().getFirstSync<Raw>("SELECT * FROM pending_messages WHERE id = ?", id);
    return r
      ? { id: r.id, owner: r.owner, thread: r.thread, body: r.body, createdAt: r.created_at, status: r.status === "failed" ? "failed" : "sending", error: r.error }
      : null;
  },
};

/** This person's unconfirmed messages in one conversation, oldest first. */
export function usePendingMessages(owner: string | null, thread: string): readonly PendingMessage[] {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => (owner ? read(owner, thread) : EMPTY),
  );
}
