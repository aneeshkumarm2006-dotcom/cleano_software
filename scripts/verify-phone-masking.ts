/* The pure edges of phone masking — the four places a mistake is silent.
 *
 *   npx tsx --conditions=react-server scripts/verify-phone-masking.ts
 *
 *   1. What normalises to E.164, because a pairing keyed on anything else can
 *      never be matched against Twilio's `From` and is a number connected to
 *      nobody.
 *   2. The expiry window, because getting it wrong strands a cleaner with a
 *      dead number an hour after clocking out — or keeps a stranger's line open
 *      for weeks.
 *   3. TwiML escaping, because these attribute values are phone numbers we
 *      store and a quote in one of them breaks the document the call rides on.
 *   4. The relayed prefix, because it is the only thing telling the recipient
 *      who is speaking.
 *
 * No database needed: every function under test is pure by construction, which
 * is why they were pulled out of the allocation path in the first place.
 */
import {
  escapeXml,
  MASKED_CALL_UNAVAILABLE,
  MASKED_TEXT_UNAVAILABLE,
  maskedContactExpiry,
  maskedDialTwiml,
  maskedPhone,
  maskedRelayBody,
  maskedSayTwiml,
} from "../src/lib/phone-masking";

// Keeps `pass`, `fail` and `check` off the global scope, where they would
// collide with every other verify script.
export {};
let pass = 0, fail = 0;
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${got === undefined ? "" : `  → ${JSON.stringify(got)}`}`); }
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function main() {
  console.log("Only numbers that reach E.164 are allowed into a pairing");
  check("already E.164 is kept", maskedPhone("+15145551234") === "+15145551234");
  check("ten digits get +1", maskedPhone("5145551234") === "+15145551234");
  check("eleven digits starting 1 get +", maskedPhone("15145551234") === "+15145551234");
  check("punctuation is stripped", maskedPhone("(514) 555-1234") === "+15145551234", maskedPhone("(514) 555-1234"));
  check("dots and spaces are stripped", maskedPhone(" 514.555.1234 ") === "+15145551234", maskedPhone(" 514.555.1234 "));
  check("a non-NANP E.164 number is kept", maskedPhone("+442071838750") === "+442071838750");

  console.log("Anything that cannot be dialled is refused, not guessed at");
  for (const bad of ["", "   ", "555-1234", "12345", "not a phone", "+1", "+", "ext. 402", "+1514555123456789"]) {
    check(`${JSON.stringify(bad)} is refused`, maskedPhone(bad) === null, maskedPhone(bad));
  }
  check("null is refused", maskedPhone(null) === null);
  check("undefined is refused", maskedPhone(undefined) === null);
  check("a number is refused", maskedPhone(5145551234 as unknown as string) === null);
  check("an object is refused", maskedPhone({ phone: "+15145551234" } as unknown as string) === null);

  console.log("The number lives a day past the job, and never less than a day");
  const now = new Date("2026-09-10T12:00:00.000Z");
  const at = (iso: string) => new Date(iso);

  const ended = maskedContactExpiry(
    { startTime: at("2026-09-10T09:00:00.000Z"), endTime: at("2026-09-10T13:00:00.000Z") },
    now,
  );
  check("end time plus 24h wins while the job is today", ended.toISOString() === "2026-09-11T13:00:00.000Z", ended.toISOString());

  const noEnd = maskedContactExpiry({ startTime: at("2026-09-12T09:00:00.000Z"), endTime: null }, now);
  check("no end time falls back to start plus 24h", noEnd.toISOString() === "2026-09-13T09:00:00.000Z", noEnd.toISOString());

  const undefEnd = maskedContactExpiry({ startTime: at("2026-09-12T09:00:00.000Z") }, now);
  check("an absent end time behaves like a null one", undefEnd.getTime() === noEnd.getTime());

  // The floor is the whole point: a job that finished an hour ago must not hand
  // back an expiry in the past, or the cleaner loses the number mid-conversation.
  const finishedHourAgo = maskedContactExpiry(
    { startTime: at("2026-09-10T07:00:00.000Z"), endTime: at("2026-09-10T11:00:00.000Z") },
    now,
  );
  check("a job that ended an hour ago still gets 24h from now", finishedHourAgo.getTime() === now.getTime() + DAY, finishedHourAgo.toISOString());

  const longFinished = maskedContactExpiry(
    { startTime: at("2026-08-01T09:00:00.000Z"), endTime: at("2026-08-01T13:00:00.000Z") },
    now,
  );
  check("a job from last month never expires in the past", longFinished.getTime() === now.getTime() + DAY);
  check("a long-finished job is never shorter than the floor", longFinished.getTime() > now.getTime());

  const future = maskedContactExpiry(
    { startTime: at("2026-10-01T09:00:00.000Z"), endTime: at("2026-10-01T12:00:00.000Z") },
    now,
  );
  check("a job three weeks out expires a day after it, not a day from now", future.toISOString() === "2026-10-02T12:00:00.000Z", future.toISOString());
  check("the result is always a Date", ended instanceof Date && future instanceof Date);
  check("the inputs are not mutated", now.toISOString() === "2026-09-10T12:00:00.000Z");

  console.log("Every XML metacharacter is escaped");
  check("ampersand", escapeXml("a&b") === "a&amp;b", escapeXml("a&b"));
  check("less than", escapeXml("a<b") === "a&lt;b");
  check("greater than", escapeXml("a>b") === "a&gt;b");
  check("double quote", escapeXml('a"b') === "a&quot;b", escapeXml('a"b'));
  check("single quote", escapeXml("a'b") === "a&apos;b", escapeXml("a'b"));
  check("ampersand is escaped first, not doubly", escapeXml("<&>") === "&lt;&amp;&gt;", escapeXml("<&>"));
  check("an ordinary number is untouched", escapeXml("+15145551234") === "+15145551234");
  check("empty stays empty", escapeXml("") === "");
  check("every occurrence is escaped, not just the first", escapeXml("&&&") === "&amp;&amp;&amp;", escapeXml("&&&"));

  console.log("Dial TwiML is well formed and closes its own attributes");
  const dial = maskedDialTwiml("+15145550000", "+15145551234");
  check("the caller id is the proxy number", dial.includes('callerId="+15145550000"'), dial);
  check("the target is the other party", dial.includes(">+15145551234</Dial>"), dial);
  check("timeout is set", dial.includes('timeout="25"'));
  check("answerOnBridge is set", dial.includes('answerOnBridge="true"'));
  check("it declares itself XML", dial.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  check("it is a single Response", dial.endsWith("</Response>") && dial.split("<Response>").length === 2);

  // A number is stored data, and stored data is where an injected quote would
  // come from. It must never be able to close the attribute it sits in.
  const hostile = maskedDialTwiml('+1514" onX="y', '+1<Hangup/>');
  check("a quote in the caller id cannot close the attribute", !hostile.includes('onX="y"'), hostile);
  check("a quote in the caller id is escaped", hostile.includes("&quot;"), hostile);
  check("a tag in the target is escaped, not emitted", !hostile.includes("<Hangup/>") && hostile.includes("&lt;Hangup/&gt;"), hostile);
  check("the document still has exactly one Dial element", hostile.split("<Dial ").length === 2 && hostile.split("</Dial>").length === 2);

  console.log("Say TwiML hangs up and says something a person can act on");
  const say = maskedSayTwiml(MASKED_CALL_UNAVAILABLE);
  check("it declares itself XML", say.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  check("it carries the sentence", say.includes(MASKED_CALL_UNAVAILABLE));
  check("it hangs up", say.includes("<Hangup/>"));
  check("a hostile message cannot inject an element", !maskedSayTwiml("<Dial>+1514</Dial>").includes("<Dial>"), maskedSayTwiml("<Dial>+1514</Dial>"));
  check("the call sentence mentions the office", MASKED_CALL_UNAVAILABLE.toLowerCase().includes("office"));
  check("the text sentence mentions the office", MASKED_TEXT_UNAVAILABLE.toLowerCase().includes("office"));
  check("neither sentence is a single SMS segment's worth of waffle", MASKED_TEXT_UNAVAILABLE.length <= 160, MASKED_TEXT_UNAVAILABLE.length);

  console.log("The relayed body says who is speaking");
  check(
    "a cleaner is labelled a cleaner",
    maskedRelayBody("Dana Whitfield", "cleaner-to-client", "on my way") === "Dana (cleaner): on my way",
    maskedRelayBody("Dana Whitfield", "cleaner-to-client", "on my way"),
  );
  check(
    "a customer is labelled a customer",
    maskedRelayBody("Sam Okafor", "client-to-cleaner", "door code is 4821") === "Sam (customer): door code is 4821",
    maskedRelayBody("Sam Okafor", "client-to-cleaner", "door code is 4821"),
  );
  check("only the first name is sent on", !maskedRelayBody("Dana Whitfield", "cleaner-to-client", "hi").includes("Whitfield"));
  check("a one-word name works", maskedRelayBody("Dana", "cleaner-to-client", "hi") === "Dana (cleaner): hi");
  check("leading whitespace is trimmed off the name", maskedRelayBody("   Dana  Whitfield ", "cleaner-to-client", "hi") === "Dana (cleaner): hi");
  check("a missing name still names the role", maskedRelayBody(null, "cleaner-to-client", "hi") === "Cleaner: hi", maskedRelayBody(null, "cleaner-to-client", "hi"));
  check("an undefined name still names the role", maskedRelayBody(undefined, "client-to-cleaner", "hi") === "Customer: hi");
  check("a blank name still names the role", maskedRelayBody("   ", "client-to-cleaner", "hi") === "Customer: hi");
  check("the body is never dropped", maskedRelayBody("Sam", "client-to-cleaner", "").endsWith(": "));
  check("newlines in the body survive", maskedRelayBody("Sam", "client-to-cleaner", "a\nb") === "Sam (customer): a\nb");
  check("the body is not otherwise rewritten", maskedRelayBody("Sam", "client-to-cleaner", "  spaced  ") === "Sam (customer):   spaced  ");

  // One Twilio message body is 1600 characters and the prefix has to fit inside
  // it. Nothing a person types on a phone comes close, so the trim exists only
  // so a pasted wall of text still sends.
  const long = maskedRelayBody("Sam", "client-to-cleaner", "x".repeat(5000));
  check("an absurd body is trimmed under Twilio's limit", long.length < 1600, long.length);
  check("a trimmed body says it was trimmed", long.endsWith("…"));
  check("a 1400-character body is untouched", maskedRelayBody("Sam", "client-to-cleaner", "x".repeat(1400)).endsWith("x"));
  check("the prefix survives the trim", long.startsWith("Sam (customer): "));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main();
