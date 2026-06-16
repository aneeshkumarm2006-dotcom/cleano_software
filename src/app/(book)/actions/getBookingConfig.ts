"use server";

import { db } from "@/db";
import { getSetting } from "@/lib/settings";

export type RoomType =
  | "KITCHEN"
  | "BATHROOM"
  | "BEDROOM"
  | "LIVING_ROOM"
  | "LAUNDRY"
  | "OUTDOOR"
  | "WHOLE_HOME";

export interface BookingAddOn {
  id: string;
  name: string;
  price: number;
  roomType: RoomType;
  /** Service types this add-on is offered for. Empty = all services. */
  services: string[];
}

const VALID_ROOMS: ReadonlySet<RoomType> = new Set([
  "KITCHEN",
  "BATHROOM",
  "BEDROOM",
  "LIVING_ROOM",
  "LAUNDRY",
  "OUTDOOR",
  "WHOLE_HOME",
]);

function normalizeAddOn(raw: unknown): BookingAddOn | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : null;
  const name = typeof r.name === "string" ? r.name : null;
  const price = typeof r.price === "number" ? r.price : null;
  if (!id || !name || price === null || price < 0) return null;
  const roomCandidate = typeof r.roomType === "string" ? (r.roomType as RoomType) : "WHOLE_HOME";
  const roomType = VALID_ROOMS.has(roomCandidate) ? roomCandidate : "WHOLE_HOME";
  const services = Array.isArray(r.services)
    ? r.services.filter((s): s is string => typeof s === "string")
    : [];
  return { id, name, price, roomType, services };
}

export async function getBookingConfig(): Promise<{
  addOns: BookingAddOn[];
  minLeadDays: number;
  smsOptInDefault: boolean;
}> {
  const [minLeadDays, smsOptInDefault] = await Promise.all([
    getSetting("scheduling.minLeadDays"),
    getSetting("customer.smsOptInDefault"),
  ]);
  try {
    const setting = await db.appSetting.findUnique({
      where: { key: "pricing.addOns" },
    });

    if (!setting || !Array.isArray(setting.value)) {
      return { addOns: [], minLeadDays, smsOptInDefault };
    }

    const normalized = setting.value
      .map(normalizeAddOn)
      .filter((a): a is BookingAddOn => a !== null);

    return { addOns: normalized, minLeadDays, smsOptInDefault };
  } catch {
    return { addOns: [], minLeadDays, smsOptInDefault };
  }
}
