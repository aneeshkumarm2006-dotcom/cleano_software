// What is stopping this booking from going forward, in the customer's words.
//
// Sept 17 list, item 9: "customer reaches the final booking step, required
// consent boxes are checked, but Confirm booking still appears greyed out."
//
// The button was not wrong. On the last step it needs the terms ticked AND a
// usable card, and a customer who ticks the two consent boxes has done one of
// those two things. What was missing is the sentence saying so. A disabled
// button with no explanation is indistinguishable from a broken one, and the
// customer's only move is to leave.
//
// WHY THE RULES MOVED HERE. They were a `switch` inside the page that answered
// yes or no. Writing a second function to explain the no would have meant two
// copies of the same rules, and the copy that drifts is always the one nobody
// is looking at — so the page would eventually say "add your card" while the
// button waited on something else. This returns the reasons, and "may proceed"
// is now "there are no reasons not to". One rule set, and it is pure, so the
// whole of it is testable without a browser.
import { isValidEmail, isValidPhone } from "@/lib/validation";
import { BOOKING_PHOTO_MIN } from "@/lib/booking-deposit";
import {
  BOOKING_PAGE_DEFAULTS,
  isFieldRequired,
  type BookingPageConfig,
} from "@/lib/booking-page-config";
import type { BookingDraft } from "./types";

/** "1 photo" / "2 photos". The minimum is configurable in principle. */
const photos = (n: number) => `${n} photo${n === 1 ? "" : "s"}`;

/** The wizard steps, named so a blocker can say which one it belongs to. */
export const STEP_POSTAL = 0;
export const STEP_PROPERTY = 1;
export const STEP_SCHEDULE = 2;
export const STEP_CONTACT = 3;
export const STEP_REVIEW = 4;

/**
 * A control the customer has to act on. Used to highlight the right one, so
 * the message and the thing it refers to are not in different places on a
 * phone screen.
 */
export type BookingField =
  | "postalCode"
  | "address"
  | "serviceType"
  | "frequency"
  | "squareFootage"
  | "photos"
  | "date"
  | "timeSlot"
  | "name"
  | "email"
  | "phone"
  | "terms"
  | "card";

export interface BookingBlocker {
  field: BookingField;
  /** Addressed to the customer, and says what to DO, not what is invalid. */
  message: string;
  /** The step that fixes it, so the page can offer to go back to it. */
  step: number;
}

/**
 * Everything standing between this draft and the end of step `s`.
 *
 * Empty means the step is satisfied. Order is the order the controls appear
 * on screen, so the first entry is the one the customer should deal with
 * first.
 */
export function stepBlockers(
  s: number,
  draft: BookingDraft,
  agree: boolean,
  bookingPage: BookingPageConfig = BOOKING_PAGE_DEFAULTS,
): BookingBlocker[] {
  const out: BookingBlocker[] = [];
  const add = (field: BookingField, message: string) =>
    out.push({ field, message, step: s });

  switch (s) {
    case STEP_POSTAL:
      if (draft.postalCovered !== true) {
        add("postalCode", "Enter a postal code we cover.");
      }
      return out;

    case STEP_PROPERTY:
      if (!draft.address.trim()) add("address", "Add the service address.");
      if (!draft.serviceType) add("serviceType", "Choose a service.");
      if (!draft.frequency) add("frequency", "Choose how often you want it.");
      // Square footage gates Continue when the admin config marks it required
      // for this service. It is pinned required for Move-in/out, which is
      // priced per square foot and cannot be quoted without it.
      if (
        isFieldRequired(bookingPage, "property", "squareFootage", draft.serviceType) &&
        !(draft.squareFootage > 0)
      ) {
        add("squareFootage", "Enter the square footage so we can price it.");
      }
      // Photos gate Continue the same way (PDF #9, Stage 11). Pinned required
      // for post-construction, which is quoted FROM the photos — a deposit
      // taken with none is a payment for a quote nobody can produce. Counted
      // against `draft.photos`, which only ever holds URLs that finished
      // uploading, so a photo still uploading reads as not yet added.
      if (
        isFieldRequired(bookingPage, "property", "photos", draft.serviceType) &&
        draft.photos.length < BOOKING_PHOTO_MIN
      ) {
        const missing = BOOKING_PHOTO_MIN - draft.photos.length;
        add(
          "photos",
          draft.photos.length === 0
            ? `Add at least ${photos(BOOKING_PHOTO_MIN)} of the space.`
            : `Add ${missing} more ${missing === 1 ? "photo" : "photos"} — uploads still in progress don't count yet.`,
        );
      }
      return out;

    case STEP_SCHEDULE:
      if (!draft.date) add("date", "Pick a date.");
      else if (!draft.isFlexible && !draft.timeSlot) {
        add("timeSlot", "Pick a start time, or choose “I'm flexible”.");
      } else if (!draft.isFlexible && draft.timeSlotValid === false) {
        add("timeSlot", "That time is no longer available — pick another one.");
      }
      return out;

    case STEP_CONTACT:
      if (!draft.name.trim()) add("name", "Add your name.");
      if (!isValidEmail(draft.email)) {
        add("email", draft.email.trim() ? "Check your email address." : "Add your email address.");
      }
      if (!isValidPhone(draft.phone)) {
        add("phone", draft.phone.trim() ? "Check your phone number." : "Add your phone number.");
      }
      return out;

    case STEP_REVIEW:
      if (!agree) add("terms", "Tick the box agreeing to the terms of service.");
      // A card is required only when there is a deposit to charge. A workspace
      // that charges none has no card step at all, and the server re-checks
      // the amount before creating anything, so this cannot be used to skip a
      // real deposit by setting a flag in the browser.
      if (!draft.depositWaived && !draft.stripeCardReady) {
        add("card", "Finish entering your card details for the deposit.");
      }
      return out;

    default:
      // An unknown step is not a step anyone may proceed past.
      add("postalCode", "Start the booking from the beginning.");
      return out;
  }
}

/**
 * What a given step requires before the wizard may move past it.
 *
 * The same rule gates the Continue button, the browser's Forward button, and a
 * restored session — rather than the first of those having a rule the other
 * two can walk around.
 */
export function stepRequirementsMet(
  s: number,
  draft: BookingDraft,
  agree: boolean,
  bookingPage: BookingPageConfig = BOOKING_PAGE_DEFAULTS,
): boolean {
  return stepBlockers(s, draft, agree, bookingPage).length === 0;
}

/**
 * The furthest step a draft actually justifies being on: the first step whose
 * own requirements aren't met.
 *
 * Step 4's requirements (terms ticked, card ready) gate submission, not
 * arrival, so they are deliberately not consulted here.
 */
export function maxReachableStep(
  draft: BookingDraft,
  agree: boolean,
  bookingPage: BookingPageConfig = BOOKING_PAGE_DEFAULTS,
): number {
  for (let i = 0; i < STEP_REVIEW; i++) {
    if (!stepRequirementsMet(i, draft, agree, bookingPage)) return i;
  }
  return STEP_REVIEW;
}
