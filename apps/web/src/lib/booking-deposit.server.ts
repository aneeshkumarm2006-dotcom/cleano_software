// Server-side companion to `booking-deposit.ts` (Stage 11 of
// `_ai_context/TODO.md`, PDF #9 "an upfront deposit … example: $200").
//
// WHY THIS FILE EXISTS
//
// The deposit amount is now an admin setting, and exactly three server paths need
// it: the PaymentIntent route that charges it, the booking action that verifies
// and stores it, and the settings tab that edits it. None of them may read the
// registry key by hand — that is how the old hardcoded 20 ended up written out in
// six places — so the key appears exactly once outside the registry, here.
//
// Keep this OUT of `booking-deposit.ts`: that module is imported by the /book
// review step (a client component), and it must stay free of the db. Same split
// as `inventory-thresholds.ts` / `.server.ts`.

import { getSetting, getSettings } from "@/lib/settings";
import {
  depositCentsForService,
  depositUsdForService,
} from "@/lib/booking-deposit";

/**
 * The admin's configured post-construction deposit, in dollars.
 *
 * Falls back to the registry default (200) on any read failure — see
 * `getSetting` — so this never resolves to 0. A $0 deposit would let the public
 * booking action mint real post-construction jobs for free, since the verified
 * payment is what stands in for authentication in the guest flow.
 */
export function loadPcDepositUsd(): Promise<number> {
  return getSetting("booking.postConstructionDepositUsd");
}

/**
 * THE deposit this service type charges right now, in dollars — the one call
 * both the charge route and `submitBooking` make.
 *
 * Resolving it in one place is what makes the two agree: the route creates an
 * intent for this many cents and the action refuses any intent that captured
 * less, so a client that asks for a post-construction booking while presenting a
 * $20 intent is rejected rather than quietly under-charged.
 */
/**
 * Both configured deposits, read in ONE query rather than two.
 *
 * Charging a deposit is already the slowest thing the booking flow does, and
 * these two are always needed together.
 */
async function loadDeposits(): Promise<{ pc: number; standard: number }> {
  const s = await getSettings([
    "booking.postConstructionDepositUsd",
    "booking.standardDepositUsd",
  ] as const);
  return {
    pc: s["booking.postConstructionDepositUsd"],
    standard: s["booking.standardDepositUsd"],
  };
}

export async function resolveDepositUsdForService(
  serviceType: string | null | undefined
): Promise<number> {
  const { pc, standard } = await loadDeposits();
  return depositUsdForService(serviceType, pc, standard);
}

/** The same figure in cents, which is the unit Stripe intents are created in. */
export async function resolveDepositCentsForService(
  serviceType: string | null | undefined
): Promise<number> {
  const { pc, standard } = await loadDeposits();
  return depositCentsForService(serviceType, pc, standard);
}
