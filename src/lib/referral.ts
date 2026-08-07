import { db } from "@/db";

// Referral economics used to live here as NEW_CLIENT_DISCOUNT / REFERRER_CREDIT.
// They now live in Settings as `customer.newClientReferralDiscountUsd` and
// `customer.referrerCreditUsd` (src/lib/settings/registry.ts), which is what
// submitBooking pays out and what the account page displays. The constants were
// removed rather than deprecated so nothing can read a stale number by accident.

// Generates a short, friendly, unique referral code like "MAPLE4Q72".
function randomCode(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I, O for readability
  const digits = "23456789"; // no 0, 1
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += letters[Math.floor(Math.random() * letters.length)];
  }
  for (let i = 0; i < 4; i++) {
    out += digits[Math.floor(Math.random() * digits.length)];
  }
  return out;
}

export async function generateUniqueReferralCode(): Promise<string> {
  // Up to 8 attempts at finding a free code. Collision probability is tiny
  // (24^4 × 8^4 ≈ 1.4B keyspace).
  for (let i = 0; i < 8; i++) {
    const code = randomCode();
    const existing = await db.client.findUnique({
      where: { referralCode: code },
    });
    if (!existing) return code;
  }
  // Fallback: include timestamp to guarantee uniqueness.
  return `R${Date.now().toString(36).toUpperCase()}`;
}

export async function ensureClientReferralCode(clientId: string): Promise<string> {
  const c = await db.client.findUnique({
    where: { id: clientId },
    select: { referralCode: true },
  });
  if (c?.referralCode) return c.referralCode;

  const code = await generateUniqueReferralCode();
  await db.client.update({
    where: { id: clientId },
    data: { referralCode: code },
  });
  return code;
}
