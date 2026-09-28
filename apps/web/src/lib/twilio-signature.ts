// Twilio's request signature, in one place.
//
// We both CHECK it (inbound webhooks) and PRODUCE it (relaying a message on to
// a workspace's other system). Those must agree exactly, and two copies of an
// HMAC recipe drift the moment one is corrected — so there is one recipe, and
// the inbound leg proves it every time a real text arrives.
//
//   base64(HMAC-SHA1(authToken, fullUrl + sorted(key + value)…))
import crypto from "crypto";

/** The signature Twilio would send for this exact request. */
export function twilioSignature(
  url: string,
  params: Record<string, string>,
  authToken: string,
): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .reduce((acc, key) => acc + key + params[key], "");
  return crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

/** Constant-time check of an inbound X-Twilio-Signature header. */
export function isValidTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null,
  authToken: string,
): boolean {
  if (!signature) return false;
  const expected = twilioSignature(url, params, authToken);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
