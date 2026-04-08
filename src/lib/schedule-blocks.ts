import { ScheduleBlocksConfig } from "@/types/calendar";

export function getBlockedTimeSlots(
  day: Date,
  scheduleBlocks: ScheduleBlocksConfig,
  roomName?: string
): Array<{
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  color?: string;
}> {
  // UI-only: return empty array
  return [];
}

