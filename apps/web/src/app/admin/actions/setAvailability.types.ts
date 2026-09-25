import type { AvailabilityDay } from "@prisma/client";

export interface AvailabilitySlotInput {
  day: AvailabilityDay;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
  isRecurring: boolean;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}
