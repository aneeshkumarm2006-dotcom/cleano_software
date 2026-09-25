// The outbox's storage: SQLite on the device, so a clock event survives the
// app being killed, the phone restarting, and days without signal.
import type { ClockEvent, ClockOutRequest } from "@bookmops/api/v1";
import * as SQLite from "expo-sqlite";

/** Everything the outbox can carry. Each is replayed exactly once (idempotency key). */
export type OutboxAction =
  | { kind: "clockIn"; jobId: string; event: ClockEvent }
  | { kind: "startBreak"; jobId: string; event: ClockEvent }
  | { kind: "endBreak"; jobId: string; event: ClockEvent }
  | { kind: "clockOut"; jobId: string; body: ClockOutRequest }
  | { kind: "checklist"; jobId: string; itemId: string; done: boolean; clientEventId: string };

export interface OutboxRow {
  /** The action's client event id: also its idempotency key. */
  id: string;
  /**
   * Whose action this is (person and company). Only the signed-in owner's
   * rows are ever sent, so a second person signing in on the same phone can
   * never send the first person's clock events under their own session.
   */
  owner: string;
  action: OutboxAction;
  createdAt: number;
  attempts: number;
  status: "pending" | "failed";
  /** Why it failed, in the server's words, for the person to see. */
  error: string | null;
}

type Raw = { id: string; owner: string; action: string; created_at: number; attempts: number; status: string; error: string | null };

let db: SQLite.SQLiteDatabase | null = null;
function open(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync("outbox.db");
    db.execSync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY NOT NULL,
        owner TEXT NOT NULL,
        action TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS outbox_owner_order ON outbox (owner, created_at);
    `);
  }
  return db;
}

const toRow = (r: Raw): OutboxRow => ({
  id: r.id,
  owner: r.owner,
  action: JSON.parse(r.action) as OutboxAction,
  createdAt: r.created_at,
  attempts: r.attempts,
  status: r.status === "failed" ? "failed" : "pending",
  error: r.error,
});

export const outboxStore = {
  add(owner: string, id: string, action: OutboxAction, createdAt: number): void {
    // OR IGNORE: the same tap recorded twice is still one event.
    open().runSync(
      "INSERT OR IGNORE INTO outbox (id, owner, action, created_at) VALUES (?, ?, ?, ?)",
      id,
      owner,
      JSON.stringify(action),
      createdAt,
    );
  },
  /** This owner's rows, oldest first: the order they were tapped in. */
  list(owner: string): OutboxRow[] {
    return open()
      .getAllSync<Raw>("SELECT * FROM outbox WHERE owner = ? ORDER BY created_at, rowid", owner)
      .map(toRow);
  },
  remove(id: string): void {
    open().runSync("DELETE FROM outbox WHERE id = ?", id);
  },
  bumpAttempts(id: string): void {
    open().runSync("UPDATE outbox SET attempts = attempts + 1 WHERE id = ?", id);
  },
  markFailed(id: string, error: string): void {
    open().runSync("UPDATE outbox SET status = 'failed', error = ? WHERE id = ?", error, id);
  },
  /** Put a failed row back in line, for "try again". */
  requeue(id: string): void {
    open().runSync("UPDATE outbox SET status = 'pending', error = NULL WHERE id = ?", id);
  },
};
