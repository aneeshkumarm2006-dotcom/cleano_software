import React from "react";
import { EventStyleInfo } from "./event-styles";
import { CalendarEvent } from "./types";
import {
  statusMeta,
  isUnconfirmed,
  isCancelled,
  payLabel,
  shortLocation,
} from "./status-meta";
import CornerBadge from "./CornerBadge";

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

const JOB_TYPE_LABEL: Record<string, string> = {
  R: "Residential",
  C: "Commercial",
  PC: "Post construction",
  F: "Follow-up",
};

function timeStr(d: Date) {
  return d
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .replace(":00", "");
}

/**
 * Shared time-grid event card (Week & Day views) — premium `.cal-ev` design.
 * Status-colored: left accent bar, client, "time · type", and a foot with
 * locality + cleaner pay on taller cards.
 */
export const EventCard: React.FC<EventCardProps> = ({
  event,
  layout,
  isBeingMoved,
  onMouseDown,
  onClick,
}) => {
  const m = statusMeta(event);
  const jt = event.metadata?.jobType as string | undefined;
  const typeName = (jt && JOB_TYPE_LABEL[jt]) || jt || "Clean";
  const loc = shortLocation(event);
  const pay = payLabel(event);

  const showMeta = layout.height >= 34;
  const showFoot = layout.height >= 72 && (loc || pay);

  const classes = [
    "cal-ev",
    isUnconfirmed(event) ? "faded" : "",
    isCancelled(event) ? "cancelled" : "",
    isBeingMoved ? "dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      data-event-card
      className={classes}
      style={
        {
          top: `${layout.top + 0.5}px`,
          height: `${layout.height}px`,
          left: layout.left,
          width: layout.width,
          background: m.tint,
          borderColor: m.color,
          // Sit above the z-20 drag-create tiles so a click opens the event
          // instead of starting a New Job selection (Day & Week views).
          zIndex: isBeingMoved ? 30 : 22,
          ["--evc" as string]: m.color,
        } as React.CSSProperties
      }
      onMouseDown={(e) => onMouseDown(e, event)}
      onClick={(e) => onClick(e, event)}>
      <span className="cal-ev-bar" style={{ background: m.color }} />
      <div className="cal-ev-in">
        <div className="cal-ev-top">
          <CornerBadge event={event} />
          <span className="cal-ev-client">{event.title}</span>
        </div>
        {showMeta ? (
          <div className="cal-ev-meta">
            {timeStr(event.start)} · {typeName}
          </div>
        ) : null}
        {showFoot ? (
          <div className="cal-ev-foot">
            {loc ? <span className="cal-ev-loc">{loc}</span> : <span />}
            {pay ? <span className="cal-ev-pay">{pay}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default EventCard;
