// API v1: the pure rules, at fixed times. No database, no server.
//
//   npx tsx --conditions react-server scripts/verify-api-v1-rules.ts
//
// The offline clock cases API_V1.md §9 asks for (a backdated event after
// online activity, a gap under the threshold and one over it, a claim from
// the future), plus the version gate, the idempotency fingerprint, and the
// session-cookie check the wrapper uses to tell 401 from ACCOUNT_INACTIVE.
import { createHmac } from "node:crypto";

import {
  ACTIVITY_RETENTION_MS,
  decideEventTime,
  offlineCorrectionReason,
  OFFLINE_APPLY_AS_CLAIMED_MS,
  RECONNECT_GRACE_MS,
} from "@bookmops/core/time";

import { roleAllowed } from "../src/server/v1/access";
import { isSendersChatAsset } from "../src/server/messages/stored-url";
import { readJsonBody } from "../src/server/v1/body";
import { canonicalJson, requestHash } from "../src/server/v1/request-hash";
import { verifiedSessionToken } from "../src/server/v1/session-token";
import { isBelow, parseVersion } from "../src/server/v1/versions";

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (ok) pass++;
  else fail++;
}

const T = (min: number, sec = 0) => new Date(Date.UTC(2026, 8, 25, 13, min, sec));
const received = T(30);

// ── Which time counts ─────────────────────────────────────────────────────
// The session was signed in long before any tap here unless a case says so.
const SIGNED_IN = new Date(Date.UTC(2026, 8, 25, 12, 0, 0));
const decide = (occurredAt: Date, activeSeconds: Date[], sessionCreatedAt: Date | null = SIGNED_IN, receivedAt = received) =>
  decideEventTime({ occurredAt, receivedAt, activeSeconds, sessionCreatedAt });
{
  const d = decide(T(27), [T(20)]);
  check("3 min gap, nothing after the tap: the phone's time", [d.kind, d.appliedAt.toISOString()], ["CLAIMED", T(27).toISOString()]);
}
{
  const d = decide(T(27), []);
  check("no activity recorded: the phone's time", d.kind, "CLAIMED");
}
{
  const d = decide(T(10), [T(5)]);
  check("20 min gap: the server's time, for review", d.kind === "RECEIVED" && [d.appliedAt.toISOString(), d.review, d.reason], [received.toISOString(), true, "GAP_OVER_LIMIT"]);
}
{
  const d = decide(T(0), [], SIGNED_IN, T(5));
  check("exactly five minutes is over the line", d.kind === "RECEIVED" && d.reason, "GAP_OVER_LIMIT");
  check("the threshold is five minutes", OFFLINE_APPLY_AS_CLAIMED_MS, 300_000);
}
{
  // Backdated: the phone made a call at :28, after claiming :27, and only
  // sent the event at :30. It was online; the claim is disproven.
  const d = decide(T(27), [T(28)]);
  check("a request after the tap disproves the claim", d.kind === "RECEIVED" && [d.reason, d.review], ["NOT_PROVEN_OFFLINE", true]);
}
{
  // The bypass this replaced: evidence at :28, then a request inside the
  // grace (:29:50) that used to overwrite the session's only "last request".
  const d = decide(T(27), [T(28), T(29, 50)]);
  check("a request in the grace doesn't erase earlier evidence", d.kind === "RECEIVED" && d.reason, "NOT_PROVEN_OFFLINE");
}
{
  // The reconnection itself: a refresh 10 s before the event arrived.
  const d = decide(T(27), [T(29, 50)]);
  check("a request in the reconnect grace doesn't disprove it", d.kind, "CLAIMED");
  check("the reconnect grace is 30 s", RECONNECT_GRACE_MS, 30_000);
}
{
  check("a request at the tap itself doesn't disprove it", decide(T(27), [T(27)]).kind, "CLAIMED");
  // The second after the tap: within the 1 s margin at worst, so it doesn't count.
  const tap = new Date(T(27).getTime() + 500);
  check("a request in the second after the tap (inside the margin) doesn't", decide(tap, [T(27, 1)]).kind, "CLAIMED");
  check("two seconds after the tap does", decide(tap, [T(27, 2)]).kind, "RECEIVED");
  // The last whole second before the grace counts; the one straddling it doesn't.
  check("a request in the last second before the grace counts", decide(T(27), [T(29, 29)]).kind, "RECEIVED");
  check("a request in the second the grace starts doesn't", decide(T(27), [T(29, 30)]).kind, "CLAIMED");
  check("activity before the tap doesn't disprove it", decide(T(27), [T(26, 59), T(25)]).kind, "CLAIMED");
}
{
  const d = decide(T(27), [], T(28));
  check("a session created after the tap: not provably offline", d.kind === "RECEIVED" && [d.reason, d.review], ["NOT_PROVEN_OFFLINE", true]);
  check("a fresh sign-in with no activity at all is still not proven", decide(T(29), [], T(29, 5)).kind, "RECEIVED");
  check("an unknown session start is not proven", decide(T(27), [], null).kind, "RECEIVED");
  check("a session created before the tap is fine", decide(T(27), [], T(26)).kind, "CLAIMED");
}
{
  const d = decide(T(35), []);
  check("a claim from the future: the server's time, nothing to review", d.kind === "RECEIVED" && [d.reason, d.review, d.appliedAt.toISOString()], ["FUTURE", false, received.toISOString()]);
}
{
  check("activity is kept 15 minutes", ACTIVITY_RETENTION_MS, 900_000);
}
{
  const reason = offlineCorrectionReason({
    kind: "CLOCK_IN",
    occurredAt: T(10),
    receivedAt: received,
    why: "GAP_OVER_LIMIT",
    fmt: (d) => d.toISOString().slice(11, 16),
  });
  check(
    "the correction reason says what happened",
    reason,
    "The app sent a clock-in tapped at 13:10 with no signal; it arrived at 13:30 and was recorded then. Approve to use the tapped time.",
  );
}

// ── App versions ──────────────────────────────────────────────────────────
check("parse '1.2.3 (45)'", parseVersion("1.2.3 (45)"), [1, 2, 3]);
check("parse '1.2.3'", parseVersion("1.2.3"), [1, 2, 3]);
check("refuse '1.2'", parseVersion("1.2"), null);
check("refuse junk", parseVersion("latest; rm -rf"), null);
check("0.9.9 is below 1.0.0", isBelow([0, 9, 9], [1, 0, 0]), true);
check("1.0.0 is not below 1.0.0", isBelow([1, 0, 0], [1, 0, 0]), false);
check("1.10.0 is not below 1.9.0", isBelow([1, 10, 0], [1, 9, 0]), false);

// ── The idempotency fingerprint ───────────────────────────────────────────
check("key order doesn't change the body", canonicalJson({ b: 1, a: { d: 2, c: 3 } }), canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
check("an undefined field is the same as a missing one", canonicalJson({ a: 1, b: undefined }), canonicalJson({ a: 1 }));
check("a different body is a different hash", requestHash("POST", "/x/j1", { a: 1 }) === requestHash("POST", "/x/j1", { a: 2 }), false);
check("a different id in the path is a different hash", requestHash("POST", "/x/j1", { a: 1 }) === requestHash("POST", "/x/j2", { a: 1 }), false);
check("a different method is a different hash", requestHash("POST", "/x/j1", { a: 1 }) === requestHash("PUT", "/x/j1", { a: 1 }), false);
check("the same request is the same hash", requestHash("post", "/x/j1", { b: 1, a: 2 }), requestHash("POST", "/x/j1", { a: 2, b: 1 }));

// ── Who may call ──────────────────────────────────────────────────────────
{
  const roles = ["EMPLOYEE", "FIELD_LEAD", "OPS_MANAGER", "ADMIN", "OWNER", "CLIENT", "APPLICANT", "", "ROOT"];
  const allow = (a: Parameters<typeof roleAllowed>[0]) => roles.filter((r) => roleAllowed(a, r));
  check("staff: the crew roles only", allow("staff"), ["EMPLOYEE", "FIELD_LEAD"]);
  check("anyStaff: every staff role, never a client or applicant", allow("anyStaff"), ["EMPLOYEE", "FIELD_LEAD", "OPS_MANAGER", "ADMIN", "OWNER"]);
  check("capability TIME_APPROVE: the four office roles", allow({ capability: "TIME_APPROVE" }), ["FIELD_LEAD", "OPS_MANAGER", "ADMIN", "OWNER"]);
  check("capability WITHDRAWALS: owner and admin", allow({ capability: "WITHDRAWALS" }), ["ADMIN", "OWNER"]);
  check("a missing role passes nothing", roleAllowed("anyStaff", null), false);
}

// ── The session cookie ────────────────────────────────────────────────────
{
  const secret = "test-secret";
  const token = "abc123TOKEN";
  const sig = createHmac("sha256", secret).update(token).digest("base64");
  const cookie = `better-auth.session_token=${encodeURIComponent(`${token}.${sig}`)}`;
  check("a signed cookie gives its token", verifiedSessionToken(cookie, secret), token);
  check("the secure-prefixed name too", verifiedSessionToken(`x=1; __Secure-${cookie}`, secret), token);
  check("a wrong secret gives nothing", verifiedSessionToken(cookie, "other"), null);
  const forged = `better-auth.session_token=${encodeURIComponent(`other.${sig}`)}`;
  check("a token with someone else's signature gives nothing", verifiedSessionToken(forged, secret), null);
  check("an unsigned cookie gives nothing", verifiedSessionToken("better-auth.session_token=abc123TOKEN", secret), null);
  check("no secret gives nothing", verifiedSessionToken(cookie, undefined), null);
}

// ── Chat attachment URLs are anchored ─────────────────────────────────────
{
  const ok = (u: string) => isSendersChatAsset(u, "acme", "user1", "demo");
  const base = "https://res.cloudinary.com/demo";
  check("the sender's own chat image", ok(`${base}/image/upload/v17/awer/acme/chat/user1/a.jpg`), true);
  check("...a raw file, no version", ok(`${base}/raw/upload/awer/acme/chat/user1/a.pdf`), true);
  check("...the legacy folder", ok(`${base}/image/upload/v1/cleano/chat/user1/a.jpg`), true);
  check("someone else's folder", ok(`${base}/image/upload/v1/awer/acme/chat/user2/a.jpg`), false);
  check("another company's folder", ok(`${base}/image/upload/v1/awer/other/chat/user1/a.jpg`), false);
  check("the folder nested deeper", ok(`${base}/image/upload/v1/x/awer/acme/chat/user1/a.jpg`), false);
  check("the folder after a transformation", ok(`${base}/image/upload/c_fill,w_9/awer/acme/chat/user1/a.jpg`), false);
  check("a fetch delivery, not an upload", ok(`${base}/image/fetch/awer/acme/chat/user1/a.jpg`), false);
  check("another cloud", ok("https://res.cloudinary.com/evil/image/upload/v1/awer/acme/chat/user1/a.jpg"), false);
  check("the folder with no file", ok(`${base}/image/upload/v1/awer/acme/chat/user1/`), false);
  check("a dot in the slug is literal", isSendersChatAsset(`${base}/image/upload/awer/aXme/chat/user1/a.jpg`, "a.me", "user1", "demo"), false);
}

// ── The body cap counts bytes, while streaming ────────────────────────────
void (async () => {
  const status = async (req: Request, cap: number) => {
    try {
      await readJsonBody(req, cap);
      return 200;
    } catch (e) {
      return (e as { status?: number }).status ?? -1;
    }
  };
  const post = (body: BodyInit, headers: Record<string, string> = {}) =>
    new Request("http://x.localhost/api/v1/x", { method: "POST", body, headers, duplex: "half" } as RequestInit);
  // 30 four-byte emoji: 60 UTF-16 units, 120 bytes (+ quotes).
  const emoji = JSON.stringify("\u{1F600}".repeat(30));
  check("multi-byte text over the cap in bytes is 413", await status(post(emoji), 100), 413);
  check("...and the same text under a byte cap that fits is read", await status(post(emoji), 200), 200);
  // No Content-Length (a stream): cut off at the cap, not buffered whole.
  let pulled = 0;
  const endless = new ReadableStream<Uint8Array>({
    pull(c) {
      pulled++;
      if (pulled > 1000) return c.close();
      c.enqueue(new Uint8Array(1024).fill(0x20));
    },
  });
  check("a streamed body with no length is refused at the cap", await status(post(endless), 4096), 413);
  check("...after reading only about the cap", pulled <= 8, true);
  check("a declared length over the cap is 413 before reading", await status(post("{}", { "content-length": "999999" }), 100), 413);
  check("an empty body is fine", await status(post(""), 100), 200);
  check("bad UTF-8 is a 400", await status(post(new Uint8Array([0x22, 0xff, 0x22])), 100), 400);


console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
})();
