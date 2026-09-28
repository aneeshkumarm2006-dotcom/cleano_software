// Push notifications (server/push): the sending rules, against a fake sender
// and a fake store. No network, no database, no phone.
//
//   npx tsx --conditions react-server scripts/verify-push.ts
//
// Covers: batching (≤100 per request), DeviceNotRegistered deletes the row,
// transient failures retried once, a replay sends nothing, nobody is pushed
// about their own action, a blocked sender is suppressed, a chat burst
// collapses to one push, a job reminder is sent once.
import fs from "node:fs";

import {
  CHAT_BURST_WINDOW_MS,
  deliver,
  EXPO_BATCH_MAX,
  officeRecipients,
  PushSendError,
  pushTeamChat,
  reminderWindow,
  sendJobReminders,
  type PushDeps,
  type PushDevice,
  type PushMessage,
  type PushTicket,
} from "../src/server/push/core";

// Belt and braces: nothing in here may reach the network.
globalThis.fetch = (() => {
  throw new Error("verify-push: network access attempted");
}) as typeof fetch;

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

const token = (n: number) => `ExponentPushToken[device-${String(n).padStart(6, "0")}]`;

interface Fake {
  deps: PushDeps;
  requests: PushMessage[][];
  devices: PushDevice[];
  logs: string[];
  /** Per-request answer; default every ticket ok. */
  answer: (messages: PushMessage[], call: number) => PushTicket[] | Error;
  clock: { now: Date };
}

function fake(devices: PushDevice[]): Fake {
  const f: Fake = {
    requests: [],
    devices: [...devices],
    logs: [],
    answer: (m) => m.map(() => ({ status: "ok" as const, id: "t" })),
    clock: { now: new Date(Date.UTC(2026, 8, 28, 14, 0, 0)) },
    deps: undefined as unknown as PushDeps,
  };
  const throttle = new Map<string, number>();
  const reminders = new Set<string>();
  f.deps = {
    sender: {
      async send(messages) {
        f.requests.push(messages);
        const a = f.answer(messages, f.requests.length);
        if (a instanceof Error) throw a;
        return a;
      },
    },
    store: {
      async devicesFor(userIds) {
        return f.devices.filter((d) => userIds.includes(d.userId));
      },
      async removeDevices(ids) {
        f.devices = f.devices.filter((d) => !ids.includes(d.id));
      },
      async claimThrottle(userIds, key, windowMs, now) {
        const out: string[] = [];
        for (const u of userIds) {
          const last = throttle.get(`${u}|${key}`);
          if (last === undefined || last <= now.getTime() - windowMs) {
            throttle.set(`${u}|${key}`, now.getTime());
            out.push(u);
          }
        }
        return out;
      },
      async claimReminder(jobId, startTime, userIds) {
        const out: string[] = [];
        for (const u of new Set(userIds)) {
          const k = `${jobId}|${u}|${startTime.toISOString()}`;
          if (reminders.has(k)) continue;
          reminders.add(k);
          out.push(u);
        }
        return out;
      },
    },
    now: () => f.clock.now,
    sleep: async () => {},
    log: (event) => {
      f.logs.push(event);
    },
  };
  return f;
}

const sent = (f: Fake) => f.requests.reduce((n, r) => n + r.length, 0);
const notice = { title: "Hello", body: "World", path: "/jobs/j1" };

async function main() {
  // ── Batching ──────────────────────────────────────────────────────────────
  {
    const devices = Array.from({ length: 250 }, (_, i) => ({ id: `d${i}`, userId: `u${i}`, token: token(i) }));
    const f = fake(devices);
    const r = await deliver(f.deps, devices.map((d) => d.userId), notice);
    check("250 devices go in 3 requests", f.requests.map((q) => q.length), [100, 100, 50]);
    check("no request over the Expo limit", f.requests.every((q) => q.length <= EXPO_BATCH_MAX), true);
    check("every device sent once", [r.sent, new Set(f.requests.flat().map((m) => m.to)).size], [250, 250]);
    check("payload carries only the path", f.requests[0][0].data, { path: "/jobs/j1" });
  }

  // ── Duplicate ids and bad tokens ──────────────────────────────────────────
  {
    const f = fake([
      { id: "a", userId: "u1", token: token(1) },
      { id: "b", userId: "u1", token: "not-a-token" },
    ]);
    const r = await deliver(f.deps, ["u1", "u1", ""], notice);
    check("a person listed twice is pushed once; a malformed token is skipped", [r.devices, sent(f)], [1, 1]);
  }

  // ── DeviceNotRegistered ───────────────────────────────────────────────────
  {
    const f = fake([
      { id: "keep", userId: "u1", token: token(1) },
      { id: "gone", userId: "u2", token: token(2) },
    ]);
    f.answer = (m) => m.map((msg) => (msg.to === token(2) ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok" }));
    const r = await deliver(f.deps, ["u1", "u2"], notice);
    check("DeviceNotRegistered removes that row only", f.devices.map((d) => d.id), ["keep"]);
    check("report counts it", [r.sent, r.removed], [1, 1]);
  }

  // ── Transient errors: retried once, never thrown ──────────────────────────
  {
    const f = fake([{ id: "a", userId: "u1", token: token(1) }]);
    f.answer = (m, call) => (call === 1 ? new PushSendError("http 503", true) : m.map(() => ({ status: "ok" as const })));
    const r = await deliver(f.deps, ["u1"], notice);
    check("a 503 is retried once and then succeeds", [f.requests.length, r.sent], [2, 1]);
  }
  {
    const f = fake([{ id: "a", userId: "u1", token: token(1) }]);
    f.answer = () => new PushSendError("http 503", true);
    const r = await deliver(f.deps, ["u1"], notice);
    check("a persistent 503: two tries, then given up without throwing", [f.requests.length, r.failed], [2, 1]);
  }
  {
    const f = fake([{ id: "a", userId: "u1", token: token(1) }]);
    f.answer = () => new PushSendError("http 400", false);
    await deliver(f.deps, ["u1"], notice);
    check("a 400 is not retried", f.requests.length, 1);
  }
  {
    const f = fake([{ id: "a", userId: "u1", token: token(1) }]);
    f.answer = (m, call) => (call === 1 ? m.map(() => ({ status: "error" as const, details: { error: "MessageRateExceeded" } })) : m.map(() => ({ status: "ok" as const })));
    const r = await deliver(f.deps, ["u1"], notice);
    check("MessageRateExceeded is retried once for that message", [f.requests.length, r.sent], [2, 1]);
  }
  {
    const f = fake([{ id: "a", userId: "u1", token: token(1) }]);
    f.deps.store.devicesFor = async () => {
      throw new Error("db down");
    };
    let threw = false;
    try {
      await deliver(f.deps, ["u1"], notice);
    } catch {
      threw = true;
    }
    check("a store failure never throws into the caller", [threw, f.logs.includes("push.deliver_failed")], [false, true]);
  }

  // ── No self-notification ──────────────────────────────────────────────────
  {
    const people = [
      { id: "owner", role: "OWNER" },
      { id: "admin", role: "ADMIN" },
      { id: "ops", role: "OPS_MANAGER" },
      { id: "lead", role: "FIELD_LEAD" },
      { id: "otherLead", role: "FIELD_LEAD" },
    ];
    check(
      "a time change: every approver, the lead of the cleaner's group, not another lead",
      officeRecipients(people, "TIME_APPROVE", { creatorId: "cleaner", creatorLeadId: "lead" }),
      ["owner", "admin", "ops", "lead"],
    );
    check(
      "an admin's own withdrawal is never pushed to them",
      officeRecipients(people, "WITHDRAWALS", { creatorId: "admin", creatorLeadId: null }),
      ["owner"],
    );
    check(
      "a lead's own time change is not pushed to them",
      officeRecipients(people, "TIME_APPROVE", { creatorId: "lead", creatorLeadId: "lead" }),
      ["owner", "admin", "ops"],
    );
    check(
      "kit requests go only to OWNER and ADMIN",
      officeRecipients(people, "KIT_REQUESTS", { creatorId: "cleaner", creatorLeadId: "lead" }),
      ["owner", "admin"],
    );

    const devices = ["sender", "a", "b"].map((u, i) => ({ id: `d-${u}`, userId: u, token: token(i) }));
    const f = fake(devices);
    await pushTeamChat(f.deps, { channelId: "c1", senderId: "sender", candidateIds: ["sender", "a", "b"], blockedSender: new Set(), notice });
    check("team chat: the sender is not pushed", f.requests.flat().map((m) => m.to).sort(), [token(1), token(2)].sort());
  }

  // ── Blocked sender ────────────────────────────────────────────────────────
  {
    const devices = ["a", "b"].map((u, i) => ({ id: `d-${u}`, userId: u, token: token(i) }));
    const f = fake(devices);
    await pushTeamChat(f.deps, { channelId: "c1", senderId: "s", candidateIds: ["a", "b"], blockedSender: new Set(["b"]), notice });
    check("someone who blocked the sender gets nothing", f.requests.flat().map((m) => m.to), [token(0)]);
  }

  // ── Burst collapse ────────────────────────────────────────────────────────
  {
    const f = fake([{ id: "d", userId: "a", token: token(1) }]);
    const msg = () => pushTeamChat(f.deps, { channelId: "c1", senderId: "s", candidateIds: ["a"], blockedSender: new Set(), notice });
    for (let i = 0; i < 5; i++) await msg();
    check("five messages in a burst: one push", sent(f), 1);
    await pushTeamChat(f.deps, { channelId: "c2", senderId: "s", candidateIds: ["a"], blockedSender: new Set(), notice });
    check("another channel is its own burst", sent(f), 2);
    f.clock.now = new Date(f.clock.now.getTime() + CHAT_BURST_WINDOW_MS + 1000);
    await msg();
    check("after the window, the next message pushes again", sent(f), 3);
  }

  // ── Job reminders ─────────────────────────────────────────────────────────
  {
    const f = fake([
      { id: "d1", userId: "c1", token: token(1) },
      { id: "d2", userId: "c2", token: token(2) },
    ]);
    const start = new Date(f.clock.now.getTime() + 55 * 60_000);
    const w = reminderWindow(f.clock.now);
    check("a job 55 min out is in this run's window", start > w.from && start <= w.to, true);
    const jobs = [{ jobId: "j1", startTime: start, userIds: ["c1", "c2"], notice: { title: "Job in 1 hour", body: "x", path: "/jobs/j1" } }];
    const first = await sendJobReminders(f.deps, jobs);
    const second = await sendJobReminders(f.deps, jobs);
    check("the reminder goes to each cleaner once", [first.sent, second.sent, sent(f)], [2, 0, 2]);
    const moved = [{ ...jobs[0], startTime: new Date(start.getTime() + 30 * 60_000) }];
    const third = await sendJobReminders(f.deps, moved);
    check("a job moved to a new start gets a new reminder", third.sent, 2);
    const later = reminderWindow(new Date(f.clock.now.getTime() + 15 * 60_000));
    check("consecutive 15-minute runs overlap (nothing falls between)", later.from <= w.to, true);
  }

  // ── Replay ────────────────────────────────────────────────────────────────
  // A replayed v1 request answers from the idempotency record and returns
  // before its handler runs, so no effect is scheduled; and a push is an
  // effect, so it sends nothing until flushed. Checked from the source, as the
  // wrapper needs a database to run.
  {
    const route = fs.readFileSync("src/server/v1/route.ts", "utf8");
    const replay = route.slice(route.indexOf('if (claim.kind === "replay")'), route.indexOf("recordId = claim.recordId"));
    check("the v1 replay branch schedules no effects", replay.length > 0 && !/flushEffects|after\(/.test(replay), true);
    const f = fake([{ id: "d", userId: "a", token: token(1) }]);
    const pending = () => deliver(f.deps, ["a"], notice);
    check("building a push effect sends nothing", sent(f), 0);
    await pending();
    check("flushing it once sends once", sent(f), 1);

    // Each service's own late-replay branch (a retry after the idempotency
    // record expired) returns the earlier answer with no effects.
    const lateReplays: [string, RegExp][] = [
      ["src/server/messages/team-chat.ts", /if \(prior\) \{[\s\S]*?return ok\(\{ message: toTeamMessage\(prior, actor\), row: prior \}\);/],
      ["src/server/messages/office-chat.ts", /if \(existing\) \{\s*const row = existing as OfficeMessageRow;\s*return ok\(\{ message: toOfficeMessage\(row, actor, slug\), row \}\);/],
      ["src/server/manager/office-inbox.ts", /if \(earlier\) return ok\(earlier\);/],
    ];
    for (const [file, re] of lateReplays) {
      check(`${file}: a late replay returns without effects`, re.test(fs.readFileSync(file, "utf8")), true);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
