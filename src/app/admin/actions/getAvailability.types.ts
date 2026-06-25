import type { AvailabilityDay } from "@prisma/client";

export interface AvailabilitySlotDTO {
  id: string;
  employeeId: string;
  day: AvailabilityDay;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
  isRecurring: boolean;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
}
