import React from "react";
import Button from "@/components/ui/Button";
import {
  EventStyleInfo,
  getBlockStripeStyle,
  getEventBackgroundColor,
  getEventBoxShadow,
} from "./event-styles";
import { CalendarEvent } from "./types";

export interface EventCardProps {
  event: CalendarEvent;
  layout: {
    top: number;
    height: number;
    left: number | string;
    width: number | string;
  };
  styleInfo: EventStyleInfo;
  isBeingMoved: boolean;
  canResize: boolean;
  minEventHeight: number;
  onMouseDown: (e: React.MouseEvent, event: CalendarEvent) => void;
  onClick: (e: React.MouseEvent, event: CalendarEvent) => void;
  renderLocation?: (event: CalendarEvent, color: string) => React.ReactNode;
  className?: string;
}

/**
 * Shared event card used in both Week and Day views.
 */
export const EventCard: React.FC<EventCardProps> = ({
  event,
  layout,
  styleInfo,
  isBeingMoved,
  canResize,
  minEventHeight,
  onMouseDown,
  onClick,
  renderLocation,
  className,
}) => {
  return (
    <Button
      data-event-card
      variant="primary"
      border={false}
      className={`
        absolute flex flex-col justify-start items-start px-2 z-30 overflow-hidden transition-none
        ${layout.height > minEventHeight ? "py-1" : "py-0"}
        ${isBeingMoved ? "opacity-70" : ""}
        cursor-pointer
        ${className ?? ""}
      `}
      style={{
        backgroundColor: getEventBackgroundColor(styleInfo),
        top: `${layout.top + 0.5}px`,
        height: `${layout.height}px`,
        left: layout.left,
        width: layout.width,
        boxShadow: getEventBoxShadow(styleInfo),
      }}
      onMouseDown={(e) => onMouseDown(e, event)}
      onClick={(e) => onClick(e, event)}>
      {/* Diagonal stripes overlay for blocks */}
      {styleInfo.isBlock && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={getBlockStripeStyle(styleInfo.color)}
        />
      )}

      <div
        className="app-title-small truncate"
        style={{ color: styleInfo.color }}>
        {event.title}
        {event.metadata?.jobId && event.metadata?.status && (
          <span
            className="ml-1 text-[10px] px-1 py-0.5 rounded"
            style={{
              backgroundColor: styleInfo.color + "30",
            }}>
            {event.metadata.status.replace("_", " ").slice(0, 4)}
          </span>
        )}
      </div>

      {layout.height > 30 && event.label && (
        <div
          className="app-subtitle truncate"
          style={{ color: styleInfo.color }}>
          {event.label}
        </div>
      )}

      {layout.height > 50 &&
        event.metadata?.location &&
        renderLocation?.(event, styleInfo.color)}
    </Button>
  );
};

export default EventCard;
