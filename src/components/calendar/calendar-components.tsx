"use client";

import React from "react";

/**
 * Resize handles for dragging event start/end times.
 * Displayed at the top and bottom of event cards.
 */
export const ResizeHandles: React.FC<{
  onResizeStart: (edge: "start" | "end", e: React.MouseEvent) => void;
}> = ({ onResizeStart }) => (
  <>
    <div
      className="absolute left-0 right-0 h-1 cursor-ns-resize"
      style={{ top: 0 }}
      onMouseDown={(e) => {
        e.stopPropagation();
        onResizeStart("start", e);
      }}
    />
    <div
      className="absolute left-0 right-0 h-1 cursor-ns-resize"
      style={{ bottom: 0 }}
      onMouseDown={(e) => {
        e.stopPropagation();
        onResizeStart("end", e);
      }}
    />
  </>
);

/**
 * Current time indicator line shown on day/week views.
 * Displays a red line with a dot at the current time.
 */
export const CurrentTimeIndicator: React.FC<{
  top: number;
}> = ({ top }) => (
  <div
    className="absolute left-0 right-0 z-50 pointer-events-none"
    style={{ top: `${top}px` }}>
    <div className="w-full h-0.5 bg-red-500 flex items-center relative">
      <span
        className="absolute -left-2"
        style={{
          width: "10px",
          height: "10px",
          borderRadius: "50%",
          backgroundColor: "#ef4444",
          display: "inline-block",
        }}
      />
    </div>
  </div>
);

