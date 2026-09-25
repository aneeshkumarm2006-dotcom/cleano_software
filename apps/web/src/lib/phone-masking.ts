/**
 * The company number that stands between a cleaner and a customer.
 *
 * Today a cleaner who has ever been assigned a job keeps that customer's real
 * mobile number permanently — it is on the job screen, in their call history,
 * and in their phone book long after they have stopped working here. Masking
 * replaces it with a number the company owns: the cleaner calls or texts that,
 * we relay to the customer, and neither side ever sees the other's real number.
 *
 * The pool lives in `ProxyNumber` and the live pairings in `MaskedContact`.
 * Both are ordinary tenant tables, so everything below runs inside an
 * organization — a request, or `runAsOrg` from the Twilio webhooks.
 *
 * NOTHING HERE THROWS AT A CALLER. Every failure is a `reason`, because the
 * fallback for "we could not mask this" is today's behaviour, and an exception
 * out of a helper on the job page would take the whole page with it.
 */
import "server-only";

import { db } from "@/lib/org-db";
import { toE164 } from "@/lib/sms";
import { getSetting } from "@/lib/settings";

/** Which way a relayed message or call is travelling. */
export type MaskedDirection = "cleaner-to-client" | "client-to-cleaner";

/** A live pairing, or the reason there isn't one. */
export type MaskedRoute =
  | { ok: true; proxyNumber: string; expiresAt: Date }
  | {
      ok: false;
      reason:
        | "disabled"
        | "no-client-phone"
        | "no-cleaner-phone"
        | "no-free-number"
        | "same-number"
        | "not-configured"
        | "error";
    };

/** The pairing an inbound message or call resolved to. */
export interface MaskedContactRef {
  id: string;
  jobId: string;
  cleanerId: string;
  clientId: string | null;
  proxyNumber: string;
  expiresAt: Date;
}

export type MaskedLookup =
  | { ok: true; to: string; direction: MaskedDirection; contact: MaskedContactRef }
  | { ok: false; reason: "unknown-number" | "unknown-sender" | "expired" };

const DAY_MS = 24 * 60 * 60 * 1000;

/* --------------------------- pure, testable bits -------------------------- */

/**
 * How long a masked number stays alive: the job's end plus a day, or its start
 * plus a day when there is no end time, and never less than a day from now.
 *
 * The floor is the part that matters. A cleaner who needs to reach the customer
 * about something they left behind, or about a key, should not find a dead
 * number an hour after clocking out — and a job edited to end in the past would
 * otherwise mint a pairing that was already expired.
 */
export function maskedContactExpiry(
  job: { startTime: Date; endTime?: Date | null },
  now: Date,
): Date {
  const anchor = job.endTime ?? job.startTime;
  const fromJob = anchor.getTime() + DAY_MS;
  const floor = now.getTime() + DAY_MS;
  return new Date(Math.max(fromJob, floor));
}

/**
 * The phone numbers masking will accept, and nothing else.
 *
 * Anything that will not normalise is refused rather than stored: a pairing
 * keyed on "555 1234" could never be matched against Twilio's `From`, which is
 * always E.164, so it would be a number quietly connected to nobody.
 */
export function maskedPhone(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  return toE164(input);
}

/** XML-escape a value going into TwiML — attributes and text alike. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Bridge the caller to the other party, still showing only the proxy number. */
export function maskedDialTwiml(callerId: string, target: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Dial callerId="${escapeXml(callerId)}" timeout="25" answerOnBridge="true">` +
    `${escapeXml(target)}</Dial></Response>`
  );
}

/** Say one sentence and hang up. Used when there is nothing to connect to. */
export function maskedSayTwiml(message: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response>` +
    `<Say>${escapeXml(message)}</Say><Hangup/></Response>`
  );
}

/** What a caller hears when the pairing has expired or never existed. */
export const MASKED_CALL_UNAVAILABLE =
  "Sorry, this number is no longer connected to that conversation. Please contact the office.";

/** What a texter is told in the same situation. Silence would leave them guessing. */
export const MASKED_TEXT_UNAVAILABLE =
  "This number is no longer connected to that conversation. Please contact the office.";

/**
 * One Twilio message body is 1600 characters. The prefix has to fit inside that
 * alongside the sender's own words, so the words are what gets trimmed — and
 * only at a length no real text message reaches.
 */
const MASKED_BODY_LIMIT = 1400;

function firstName(name: string | null | undefined): string | null {
  const first = (typeof name === "string" ? name : "").trim().split(/\s+/)[0] ?? "";
  return first || null;
}

/**
 * The relayed text, prefixed with who is speaking.
 *
 * Both sides see an unfamiliar company number, so without this a cleaner
 * juggling six jobs gets "running 10 minutes late" from nobody in particular.
 * The role is spelled out on both legs — a bare first name tells a cleaner who
 * texted but not that it was a customer at all.
 */
export function maskedRelayBody(
  senderName: string | null | undefined,
  direction: MaskedDirection,
  body: string,
): string {
  const role = direction === "cleaner-to-client" ? "cleaner" : "customer";
  const first = firstName(senderName);
  const who = first ? `${first} (${role})` : role === "cleaner" ? "Cleaner" : "Customer";
  const text =
    body.length > MASKED_BODY_LIMIT ? `${body.slice(0, MASKED_BODY_LIMIT - 1)}…` : body;
  return `${who}: ${text}`;
}

/* ------------------------------ allocation -------------------------------- */

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/**
 * Allocate or reuse the pairing that lets this cleaner reach this job's client.
 *
 * `disabled` and `not-configured` are normal states, not errors: a workspace
 * that has not turned masking on, or has not bought any numbers yet, gets the
 * behaviour it has always had.
 */
export async function maskedNumberForJob(
  jobId: string,
  cleanerId: string,
): Promise<MaskedRoute> {
  try {
    if (!(await getSetting("provider.maskCustomerPhone"))) {
      return { ok: false, reason: "disabled" };
    }

    const now = new Date();

    // A job we cannot see is a job in another organization, or a deleted one.
    // Either way there is no customer number to reach, which is what the caller
    // needs to know.
    const job = await db.job.findFirst({
      where: { id: jobId },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        clientId: true,
        client: { select: { phone: true } },
      },
    });
    if (!job) return { ok: false, reason: "no-client-phone" };

    const expiresAt = maskedContactExpiry(job, now);

    // Reuse before allocating. The cleaner has already been given this number —
    // handing them a second one mid-job would strand the thread they are in.
    const existing = await db.maskedContact.findFirst({
      where: { jobId, cleanerId, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        expiresAt: true,
        proxyNumber: { select: { phoneNumber: true } },
      },
    });
    // Deliberately not gated on `isActive`. Taking a number out of service
    // stops NEW allocations; it must not move a cleaner who is mid-job onto a
    // different number, because `resolveMaskedRoute` keeps relaying the old one
    // until it expires and the cleaner would be shown a number that is not the
    // one their conversation is on.
    if (existing) {
      // Never shorten: a job edited to end sooner must not cut off a
      // conversation the cleaner is already having on this number.
      const extended = expiresAt > existing.expiresAt ? expiresAt : existing.expiresAt;
      await db.maskedContact.update({
        where: { id: existing.id },
        data: { expiresAt: extended, lastUsedAt: now },
      });
      return { ok: true, proxyNumber: existing.proxyNumber.phoneNumber, expiresAt: extended };
    }

    const cleaner = await db.user.findFirst({
      where: { id: cleanerId },
      select: { phone: true },
    });
    const cleanerPhone = maskedPhone(cleaner?.phone);
    if (!cleanerPhone) return { ok: false, reason: "no-cleaner-phone" };

    const clientPhone = maskedPhone(job.client?.phone);
    if (!clientPhone) return { ok: false, reason: "no-client-phone" };

    // Same number on both sides — a cleaner cleaning their own place, or a typo.
    // No proxy number can serve it: an inbound message from that number would
    // match both legs of the pairing and the reverse lookup would have to guess
    // which way to relay it.
    if (cleanerPhone === clientPhone) return { ok: false, reason: "same-number" };

    // Reclaim first, and not as an optimisation. The unique indexes on
    // (proxyNumberId, cleanerPhone) and (proxyNumberId, clientPhone) know
    // nothing about expiry, so a dead pairing still blocks its number for that
    // participant. Without this sweep the pool silently exhausts.
    await db.maskedContact.deleteMany({ where: { expiresAt: { lte: now } } });

    const numbers = await db.proxyNumber.findMany({
      where: { isActive: true },
      select: {
        id: true,
        phoneNumber: true,
        contacts: {
          where: { expiresAt: { gt: now } },
          select: {
            cleanerPhone: true,
            clientPhone: true,
            lastUsedAt: true,
            createdAt: true,
          },
        },
      },
    });
    if (numbers.length === 0) return { ok: false, reason: "not-configured" };

    // A number is free for this pair when neither participant is already live on
    // it — in EITHER column. One number can carry several pairings at once, but
    // never two involving the same phone, or an inbound message from that phone
    // would be unattributable.
    const candidates = numbers
      .filter((n) =>
        n.contacts.every(
          (c) =>
            c.cleanerPhone !== cleanerPhone &&
            c.clientPhone !== cleanerPhone &&
            c.cleanerPhone !== clientPhone &&
            c.clientPhone !== clientPhone,
        ),
      )
      .map((n) => ({
        id: n.id,
        phoneNumber: n.phoneNumber,
        // Least recently used first, so pairings spread across the pool instead
        // of piling on whichever number happens to sort first. A number with no
        // live pairings scores 0 and is always preferred.
        usedAt: n.contacts.reduce(
          (max, c) => Math.max(max, (c.lastUsedAt ?? c.createdAt).getTime()),
          0,
        ),
      }))
      .sort((a, b) => a.usedAt - b.usedAt || a.phoneNumber.localeCompare(b.phoneNumber));

    if (candidates.length === 0) return { ok: false, reason: "no-free-number" };

    for (const candidate of candidates) {
      try {
        await db.maskedContact.create({
          data: {
            jobId: job.id,
            cleanerId,
            clientId: job.clientId,
            proxyNumberId: candidate.id,
            cleanerPhone,
            clientPhone,
            expiresAt,
            lastUsedAt: now,
          },
        });
        return { ok: true, proxyNumber: candidate.phoneNumber, expiresAt };
      } catch (e) {
        // Two cleaners allocating at the same instant both read this number as
        // free; the unique index lets exactly one of them keep it. The loser
        // takes the next candidate rather than failing the whole request.
        if (isUniqueViolation(e)) continue;
        throw e;
      }
    }

    return { ok: false, reason: "no-free-number" };
  } catch (e) {
    // Its own reason, not "no-free-number": an exhausted pool is something an
    // admin fixes by buying a number, and reporting a bug as that sends them
    // shopping instead of to the logs.
    console.error("[phone-masking] allocation failed", e);
    return { ok: false, reason: "error" };
  }
}

/* ----------------------------- reverse lookup ----------------------------- */

/**
 * Who was the sender trying to reach?
 *
 * Twilio hands the webhooks `To` (the proxy number) and `From` (one of the two
 * participants) and nothing else, so that pair IS the routing key — which is
 * what the unique indexes on `MaskedContact` exist to keep answerable.
 */
export async function resolveMaskedRoute(
  proxyNumber: string,
  from: string,
): Promise<MaskedLookup> {
  try {
    const proxy = maskedPhone(proxyNumber);
    if (!proxy) return { ok: false, reason: "unknown-number" };
    const sender = maskedPhone(from);
    if (!sender) return { ok: false, reason: "unknown-sender" };

    const contact = await db.maskedContact.findFirst({
      where: {
        proxyNumber: { phoneNumber: proxy },
        OR: [{ cleanerPhone: sender }, { clientPhone: sender }],
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        jobId: true,
        cleanerId: true,
        clientId: true,
        cleanerPhone: true,
        clientPhone: true,
        expiresAt: true,
      },
    });

    // "Nobody is paired on this number" and "we do not own this number at all"
    // are different problems, and only one of them is worth an admin's time.
    if (!contact) {
      const known = await db.proxyNumber.findFirst({
        where: { phoneNumber: proxy },
        select: { id: true },
      });
      return { ok: false, reason: known ? "unknown-sender" : "unknown-number" };
    }
    if (contact.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

    const direction: MaskedDirection =
      sender === contact.cleanerPhone ? "cleaner-to-client" : "client-to-cleaner";

    // Stamped so the pool's least-recently-used ordering reflects real traffic,
    // not just when a pairing was created. Never worth failing a relay over.
    await db.maskedContact
      .update({ where: { id: contact.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});

    return {
      ok: true,
      to: direction === "cleaner-to-client" ? contact.clientPhone : contact.cleanerPhone,
      direction,
      contact: {
        id: contact.id,
        jobId: contact.jobId,
        cleanerId: contact.cleanerId,
        clientId: contact.clientId,
        proxyNumber: proxy,
        expiresAt: contact.expiresAt,
      },
    };
  } catch (e) {
    console.error("[phone-masking] lookup failed", e);
    return { ok: false, reason: "unknown-number" };
  }
}

/**
 * Delete pairings that are past `expiresAt`, freeing their numbers.
 *
 * Allocation sweeps as it goes, so this is the safety net for a pool nobody is
 * allocating from — a workspace whose season ended still gets its numbers back.
 * Returns how many rows went.
 */
export async function releaseExpiredMaskedContacts(): Promise<number> {
  try {
    const res = await db.maskedContact.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
    return res.count;
  } catch (e) {
    console.error("[phone-masking] expiry sweep failed", e);
    return 0;
  }
}
