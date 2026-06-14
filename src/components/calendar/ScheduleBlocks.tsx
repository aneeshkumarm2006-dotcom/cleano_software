import React from "react";
import {
  MIN_BLOCK_HEIGHT,
  OfficeHours,
  getVisibleTimeBounds,
} from "./calendar-helpers";
import { ScheduleBlocksConfig } from "@/types/calendar";
import { getBlockedTimeSlots } from "@/lib/schedule-blocks";

interface ScheduleBlocksProps {
  day: Date;
  scheduleBlocks: ScheduleBlocksConfig;
  officeHours: OfficeHours | null;
  zoomLevel: number;
  roomName?: string;
}

/**
 * Shared renderer for schedule blocks across Week and Day views.
 */
export const ScheduleBlocks: React.FC<ScheduleBlocksProps> = ({
  day,
  scheduleBlocks,
  officeHours,
  zoomLevel,
  roomName,
}) => {
  const blockedSlots = getBlockedTimeSlots(day, scheduleBlocks, roomName);
  const { start: visibleStart, end: visibleEnd } = getVisibleTimeBounds(
    day,
    officeHours
  );

  return (
    <>
      {blockedSlots
        .map((block) => {
          const [startHour, startMin] = block.startTime.split(":").map(Number);
          const [endHour, endMin] = block.endTime.split(":").map(Number);

          const blockStart = new Date(day);
          blockStart.setHours(startHour, startMin, 0, 0);
          const blockEnd = new Date(day);
          blockEnd.setHours(endHour, endMin, 0, 0);

          // Skip blocks outside visible range
          if (
            blockStart.getTime() >= visibleEnd.getTime() ||
            blockEnd.getTime() <= visibleStart.getTime()
          ) {
            return null;
          }

          // Clip to visible boundaries
          const segStart = new Date(
            Math.max(blockStart.getTime(), visibleStart.getTime())
          );
          const segEnd = new Date(
            Math.min(blockEnd.getTime(), visibleEnd.getTime())
          );

          const officeStart = officeHours?.start || 0;
          const top =
            (segStart.getHours() - officeStart) * zoomLevel +
            (segStart.getMinutes() * zoomLevel) / 60;
          const height = Math.max(
            MIN_BLOCK_HEIGHT,
            (segEnd.getHours() - segStart.getHours()) * zoomLevel +
              ((segEnd.getMinutes() - segStart.getMinutes()) * zoomLevel) / 60
          );

          return (
            <div
              key={`${block.id}-${day.toISOString()}`}
              className="cal-block"
              style={{ top: `${top}px`, height: `${height}px`, zIndex: 10 }}
              title={`${block.title} (${block.startTime} - ${block.endTime})`}>
              <span>{block.title}</span>
            </div>
          );
        })
        .filter(Boolean)}
    </>
  );
};

export default ScheduleBlocks;

