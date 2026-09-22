/**
 * The auth rate limit, guarded in BOTH directions.
 *
 * The blanket five-a-minute is the right number for a credential endpoint. It
 * was the wrong number for `get-session`, which is a read: a customer working
 * through the five booking steps produced a run of 429s on
 * /api/auth/get-session (seen live on cleanocalgary.useawer.com/book), because
 * the public booking page calls `authClient.useSession()` to prefill a
 * signed-in client's details and React remounts it more than five times a
 * minute. The 429 was not refusing an attack, it was handing a signed-in
 * customer a blank contact form.
 *
 * So `get-session` was raised — and nothing else was. This test exists to stop
 * that relaxation quietly spreading to the endpoints where brute force can
 * actually win something.
 */
import { readFileSync } from "node:fs";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => {
  if (ok) passed++;
  else failures.push(name);
};

const src = readFileSync("src/lib/auth.ts", "utf8");

// The block is small; read it rather than the whole file, so an unrelated `max`
// elsewhere cannot satisfy these.
const start = src.indexOf("rateLimit: {");
check("auth.ts configures rateLimit explicitly", start !== -1);
const block = start === -1 ? "" : src.slice(start, start + 1600);

check("rate limiting is enabled", /enabled:\s*true/.test(block));
check("the default window is 60s", /window:\s*60,/.test(block));
check("the default cap is 5", /max:\s*5,/.test(block));

check("there is a custom rule for get-session", /customRules:\s*\{/.test(block));
check(
  "get-session is the rule that was raised",
  /"\/get-session":\s*\{\s*window:\s*60,\s*max:\s*100\s*\}/.test(block),
);

// The point of the whole file: credential endpoints must NOT appear here.
// Adding one would silently widen the brute-force window.
const CREDENTIAL_PATHS = [
  "/sign-in",
  "/sign-up",
  "/forget-password",
  "/reset-password",
  "/change-password",
  "/change-email",
  "/verify-email",
  "/two-factor",
];
const rulesStart = block.indexOf("customRules:");
const rules = rulesStart === -1 ? "" : block.slice(rulesStart);
for (const p of CREDENTIAL_PATHS) {
  check(`${p} is NOT exempted from the default limit`, !rules.includes(`"${p}`));
}

// Only one path may be relaxed. A second entry is a review trigger, not a pass.
const relaxed = (rules.match(/"\/[a-z-]+":/g) ?? []).length;
check("exactly one path is relaxed", relaxed === 1);

if (failures.length) {
  console.error(`✘ ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`✔ ${passed} passed, 0 failed`);
