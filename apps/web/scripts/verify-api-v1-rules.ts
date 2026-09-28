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
  decideEventTime,
  offlineCorrectionReason,
  OFFLINE_APPLY_AS_CLAIMED_MS,
  RECONNECT_GRACE_MS,
} from "@bookmops/core/time";

import { roleAllowed } from "../src/server/v1/access";
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
{
  const d = decideEventTime({ occurredAt: T(27), receivedAt: received, lastRequestAt: T(20) });
  check("3 min gap, nothing after the tap: the phone's time", [d.kind, d.appliedAt.toISOString()], ["CLAIMED", T(27).toISOString()]);
}
{
  const d = decideEventTime({ occurredAt: T(27), receivedAt: received, lastRequestAt: null });
  check("no request ever recorded: the phone's time", d.kind, "CLAIMED");
}
{
  const d = decideEventTime({ occurredAt: T(10), receivedAt: received, lastRequestAt: T(5) });
  check("20 min gap: the server's time, for review", d.kind === "RECEIVED" && [d.appliedAt.toISOString(), d.review, d.reason], [received.toISOString(), true, "GAP_OVER_LIMIT"]);
}
{
  const d = decideEventTime({ occurredAt: T(0), receivedAt: T(5), lastRequestAt: null });
  check("exactly five minutes is over the line", d.kind === "RECEIVED" && d.reason, "GAP_OVER_LIMIT");
  check("the threshold is five minutes", OFFLINE_APPLY_AS_CLAIMED_MS, 300_000);
}
{
  // Backdated: the phone made a call at :28, after claiming :27, and only
  // sent the event at :30. It was online; the claim is disproven.
  const d = decideEventTime({ occurredAt: T(27), receivedAt: received, lastRequestAt: T(28) });
  check("a request after the tap disproves the claim", d.kind === "RECEIVED" && [d.reason, d.review], ["NOT_PROVEN_OFFLINE", true]);
}
{
  // The reconnection itself: a refresh 10 s before the event arrived.
  const d = decideEventTime({ occurredAt: T(27), receivedAt: received, lastRequestAt: T(29, 50) });
  check("a request in the reconnect grace doesn't disprove it", d.kind, "CLAIMED");
  check("the reconnect grace is 30 s", RECONNECT_GRACE_MS, 30_000);
}
{
  const d = decideEventTime({ occurredAt: T(27), receivedAt: received, lastRequestAt: T(27) });
  check("a request at the tap itself doesn't disprove it", d.kind, "CLAIMED");
}
{
  const d = decideEventTime({ occurredAt: T(35), receivedAt: received, lastRequestAt: null });
  check("a claim from the future: the server's time, nothing to review", d.kind === "RECEIVED" && [d.reason, d.review, d.appliedAt.toISOString()], ["FUTURE", false, received.toISOString()]);
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
