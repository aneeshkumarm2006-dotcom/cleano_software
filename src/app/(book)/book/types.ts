export type Frequency =
  | "ONE_TIME"
  | "WEEKLY"
  | "BIWEEKLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "TWICE_WEEKLY"
  | "HIGH_FREQUENCY";

// Single declaration in @/lib/addon-catalog, which also validates it on read.
export type { RoomType } from "@/lib/addon-catalog";
import type { RoomType } from "@/lib/addon-catalog";

export interface AddOnSelection {
  id?: string;
  name: string;
  /** UNIT price. The line total is `price * quantity` — see addOnLineTotal(). */
  price: number;
  roomType?: RoomType;
  /** Service types this add-on shows for. Empty = all services. */
  services?: string[];
  selected: boolean;
  /**
   * How many of this add-on (awerfixes item 7). Invariant: `selected` is the
   * source of truth for visibility and `quantity` tracks it — selected rows are
   * always >= 1, deselected rows are 0. Nothing downstream has to reason about
   * a selected-but-zero row.
   */
  quantity: number;
  /** Icon key from the catalog; absent = guess from the name (item 17). */
  icon?: string;
  /** Show a message before this add-on is added to the booking (item 17). */
  popupEnabled?: boolean;
  popupTitle?: string;
  popupMessage?: string;
  popupRequestPhoto?: boolean;
}

/**
 * Should selecting this add-on open its pop-up first?
 *
 * DESELECTING never prompts — a customer removing something has nothing to be
 * told, and a modal there would read as the app arguing with them.
 */
export function needsPopup(a: AddOnSelection): boolean {
  return !a.selected && a.popupEnabled === true;
}

/** One photo the customer uploaded at booking time (PDF #9 / Stage 11). */
export interface BookingPhoto {
  /** Cloudinary secure URL. The only field `submitBooking` trusts, after re-validation. */
  url: string;
  /** Cloudinary public id — kept so the UI can key the thumbnail list stably. */
  publicId: string;
}

export interface BookingDraft {
  // Step 1
  postalCode: string;
  postalCovered: boolean | null;
  zoneName: string | null;
  travelFee: number;
  // Step 2
  address: string;
  /**
   * Unit / apartment number (item 2). New in stage 4: /book never captured one,
   * so a web-booked job reached the cleaner with no way into the building.
   */
  aptNumber: string;
  /**
   * The saved ClientAddress this booking is for, when a signed-in customer
   * picked one. Null = they typed a fresh address, which submitBooking adds to
   * their book. Server-revalidated — submitBooking is public, so this id is
   * untrusted input.
   */
  addressId: string | null;
  /**
   * Apartment/condo vs house (Stage 9 / PDF #11). "" = not answered, which is
   * a legitimate outcome: the field is optional and an admin can hide it
   * entirely from Settings, so nothing here may assume a value. Typed as a
   * plain string like `serviceType`; `parsePropertyType` is what turns it into
   * a column value, server-side, in submitBooking.
   */
  propertyType: string;
  bedCount: number;
  bathCount: number;
  halfBathCount: number;
  squareFootage: number;
  serviceType: string;
  frequency: Frequency;
  addOns: AddOnSelection[];
  // Post-construction specific
  pcHours: number;
  pcCleaners: number;
  /**
   * Photos of the space, uploaded during step 2 (PDF #9 / Stage 11).
   *
   * Already IN STORAGE by the time they land here — `uploadBookingPhoto` puts
   * each file on Cloudinary and returns its URL, because the job these attach to
   * does not exist until the booking is submitted. Carrying URLs rather than
   * `File` objects is also what lets a restored draft keep its photos: a File
   * cannot survive sessionStorage, a URL can.
   *
   * Required for post-construction and hidden for everything else, per the
   * booking-page config. `submitBooking` re-validates every URL server-side.
   */
  photos: BookingPhoto[];
  // Step 3
  date: string;
  isFlexible: boolean;
  timeSlot: string;
  // False when the chosen timeSlot falls in an admin-blocked window / outside
  // business hours / at capacity. Undefined until validated. Gates "Next".
  timeSlotValid?: boolean;
  // Step 4
  name: string;
  phone: string;
  email: string;
  notes: string;
  referralCode: string;
  promoCode?: string;
  promoDiscount?: number;
  promoApplied?: boolean;
  // Step 5 — Stripe
  stripeCustomerId?: string;
  stripeCardReady?: boolean;
  // Step 5 — after-photo consent (opt-in, not pre-selected)
  afterPhotoConsent: boolean;
  // Step 4 — SMS notification consent (default from customer.smsOptInDefault)
  smsConsent: boolean;
}

export const EMPTY_DRAFT: BookingDraft = {
  postalCode: "",
  postalCovered: null,
  zoneName: null,
  travelFee: 0,
  address: "",
  aptNumber: "",
  addressId: null,
  propertyType: "",
  bedCount: 2,
  bathCount: 1,
  halfBathCount: 0,
  squareFootage: 0,
  serviceType: "STANDARD",
  frequency: "ONE_TIME",
  addOns: [],
  pcHours: 4,
  pcCleaners: 2,
  photos: [],
  date: "",
  isFlexible: true,
  timeSlot: "",
  name: "",
  phone: "",
  email: "",
  notes: "",
  referralCode: "",
  // Item 21: after-photos are allowed by default — pre-checked; the customer
  // unchecks to opt out for their booking.
  afterPhotoConsent: true,
  smsConsent: true,
};

export const SERVICE_TYPES: { value: string; label: string }[] = [
  { value: "STANDARD", label: "Standard cleaning" },
  { value: "DEEP", label: "Deep cleaning" },
  { value: "MOVE_IN_OUT", label: "Move-in / move-out" },
  { value: "POST_CONSTRUCTION", label: "Post-construction" },
  { value: "AIRBNB", label: "Airbnb turnover" },
];

// Frequency CHOICES and their labels now live in @/lib/booking-page-config as
// admin-editable config (item 17), per service type — that is what item 14's
// "Minimum N times per month" Airbnb labels are expressed in. The discount
// PERCENTAGES live in Settings → Pricing Rules (`pricing.serviceTypes`). The
// two hardcoded lists that used to sit here were deleted rather than left
// beside the config: the Airbnb one carried its own discount ladder, which was
// a second source of truth for money.

export const PC_HOURLY_RATE = 50; // $50/hr per cleaner for post-construction

// Legacy fixed slots — kept for backward-compat helpers. The booking time
// picker now lets customers choose any time within the business-hours window
// below (down to the minute), so this list is no longer the source of truth.
export const TIME_SLOTS: string[] = ["08:00", "10:00", "12:00", "14:00"];

// Bookable business-hours window (inclusive). Customers may pick any time
// between these, to the minute, unless an admin has blocked it.
export const BOOKING_DAY_START = "09:00"; // 9 AM
export const BOOKING_DAY_END = "19:00"; // 7 PM

// Hourly quick-pick chips spanning the window (9 AM … 7 PM).
export const TIME_SLOT_SUGGESTIONS: string[] = Array.from(
  { length: 11 },
  (_, i) => `${String(9 + i).padStart(2, "0")}:00`
);
