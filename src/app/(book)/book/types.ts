export type Frequency =
  | "ONE_TIME"
  | "WEEKLY"
  | "BIWEEKLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "TWICE_WEEKLY"
  | "HIGH_FREQUENCY";

export type RoomType =
  | "KITCHEN"
  | "BATHROOM"
  | "BEDROOM"
  | "LIVING_ROOM"
  | "LAUNDRY"
  | "OUTDOOR"
  | "WHOLE_HOME";

export interface AddOnSelection {
  id?: string;
  name: string;
  price: number;
  roomType?: RoomType;
  selected: boolean;
}

export interface BookingDraft {
  // Step 1
  postalCode: string;
  postalCovered: boolean | null;
  zoneName: string | null;
  travelFee: number;
  // Step 2
  address: string;
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
  // Step 3
  date: string;
  isFlexible: boolean;
  timeSlot: string;
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
}

export const EMPTY_DRAFT: BookingDraft = {
  postalCode: "",
  postalCovered: null,
  zoneName: null,
  travelFee: 0,
  address: "",
  bedCount: 2,
  bathCount: 1,
  halfBathCount: 0,
  squareFootage: 0,
  serviceType: "STANDARD",
  frequency: "ONE_TIME",
  addOns: [],
  pcHours: 4,
  pcCleaners: 2,
  date: "",
  isFlexible: true,
  timeSlot: "",
  name: "",
  phone: "",
  email: "",
  notes: "",
  referralCode: "",
};

export const SERVICE_TYPES: { value: string; label: string }[] = [
  { value: "STANDARD", label: "Standard cleaning" },
  { value: "DEEP", label: "Deep cleaning" },
  { value: "MOVE_IN_OUT", label: "Move-in / move-out" },
  { value: "POST_CONSTRUCTION", label: "Post-construction" },
  { value: "AIRBNB", label: "Airbnb turnover" },
];

export const FREQUENCIES: { value: Frequency; label: string; hint?: string }[] =
  [
    { value: "ONE_TIME", label: "One-time", hint: "Just this cleaning" },
    { value: "WEEKLY", label: "Weekly", hint: "Auto-books the next 4 weekly visits" },
    { value: "BIWEEKLY", label: "Every 2 weeks", hint: "Auto-books the next 4 visits" },
    { value: "MONTHLY", label: "Monthly", hint: "Auto-books the next 3 monthly visits" },
    { value: "QUARTERLY", label: "Quarterly", hint: "Auto-books the next 2 quarterly visits" },
  ];

export const AIRBNB_FREQUENCIES: { value: Frequency; label: string; hint?: string; discount: number }[] =
  [
    { value: "ONE_TIME", label: "One-time", hint: "Full price", discount: 0 },
    { value: "BIWEEKLY", label: "Every 2 weeks", hint: "8% off every visit", discount: 8 },
    { value: "WEEKLY", label: "Weekly", hint: "10% off every visit", discount: 10 },
    { value: "TWICE_WEEKLY", label: "Twice a week (~8/mo)", hint: "15% off every visit", discount: 15 },
    { value: "HIGH_FREQUENCY", label: "Daily / 20+ per month", hint: "20% off every visit", discount: 20 },
  ];

export const PC_HOURLY_RATE = 50; // $50/hr per cleaner for post-construction

export const TIME_SLOTS: string[] = ["08:00", "10:00", "12:00", "14:00"];
