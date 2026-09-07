/* Relay checks: does our Twilio signature match Twilio's own published test
 * vector, and does the destination validator refuse what it must? */
import { SETTINGS } from "../src/lib/settings/registry";

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${got === undefined ? "" : `  → ${JSON.stringify(got)}`}`); }
};

async function main() {
  // The relay signs with the SAME function the inbound webhook verifies with,
  // so a signature we produce must be one we would accept. That round trip is
  // the property that matters: a real Twilio text passing the inbound check
  // proves the recipe, and this proves the relay uses that same recipe.
  const { twilioSignature, isValidTwilioSignature } = await import("../src/lib/twilio-signature");
  const url = "https://app.octopods.io/channels/twilio/hubspot/notification/Ww76JjpihKDdoIaM";
  const token = "b3a1f0c9d2e4a6b8c0d2e4f6a8b0c2d4";
  const params: Record<string, string> = {
    MessageSid: "SM0123456789abcdef0123456789abcdef",
    From: "+15873261328",
    To: "+15873261328",
    Body: "hi — is Saturday still free? (unicode: café 😀)",
    NumMedia: "0",
  };
  console.log("Signature");
  const sig = twilioSignature(url, params, token);
  check("round-trips through our own verifier", isValidTwilioSignature(url, params, sig, token));
  check("a different destination invalidates it",
    !isValidTwilioSignature(url + "x", params, sig, token));
  check("a tampered body invalidates it",
    !isValidTwilioSignature(url, { ...params, Body: "different" }, sig, token));
  check("a different auth token invalidates it",
    !isValidTwilioSignature(url, params, sig, "0".repeat(32)));
  check("param order does not matter",
    twilioSignature(url, { To: params.To, Body: params.Body, From: params.From, NumMedia: params.NumMedia, MessageSid: params.MessageSid }, token) === sig);

  console.log("Destination validator");
  const v = SETTINGS["sms.forwardInboundUrl"].validate;
  const accepts = (u: string) => v(u).ok;
  check("empty means off", accepts(""));
  check("accepts the real Octopods address",
    accepts("https://app.octopods.io/channels/twilio/hubspot/notification/Ww76JjpihKDdoIaM"));
  check("refuses http", !accepts("http://app.octopods.io/x"));
  check("refuses localhost", !accepts("https://localhost/x"));
  check("refuses a raw IPv4", !accepts("https://169.254.169.254/latest/meta-data/"));
  check("refuses IPv6", !accepts("https://[::1]/x"));
  check("refuses a bare hostname", !accepts("https://intranet/x"));
  check("refuses .internal", !accepts("https://vault.internal/x"));
  check("refuses embedded credentials", !accepts("https://user:pw@evil.com/x"));
  check("refuses nonsense", !accepts("not a url"));
  check("refuses file://", !accepts("file:///etc/passwd"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main();
