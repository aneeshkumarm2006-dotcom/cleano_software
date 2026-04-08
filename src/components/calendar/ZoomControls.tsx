"use client";

import React from "react";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { useCalendar } from "./CalendarContext";
import IconButton from "@/components/ui/IconButton";
import Card from "@/components/ui/Card";

export default function ZoomControls() {
  const { zoomLevel, setZoomLevel } = useCalendar();

  const zoomLevels = [56, 64, 75, 86, 94]; // pixels per hour (75px = 100%)
  const currentIndex = zoomLevels.indexOf(zoomLevel);

  const zoomIn = () => {
    const nextIndex = Math.min(currentIndex + 1, zoomLevels.length - 1);
    setZoomLevel(zoomLevels[nextIndex]);
  };

  const zoomOut = () => {
    const prevIndex = Math.max(currentIndex - 1, 0);
    setZoomLevel(zoomLevels[prevIndex]);
  };

  const resetZoom = () => {
    setZoomLevel(75); // Default zoom level
  };

  const getZoomLabel = () => {
    switch (zoomLevel) {
      case 56:
        return "75%";
      case 64:
        return "85%";
      case 75:
        return "100%";
      case 86:
        return "115%";
      case 94:
        return "125%";
      default:
        return "100%";
    }
  };

  return (
    <Card className="!py-[.05rem] !w-fit flex items-center gap-1 ">
      <IconButton
        icon={ZoomOut}
        size="md"
        variant="ghost"
        onClick={zoomOut}
        disabled={currentIndex === 0}
        className="text-[#005F6A]/40 hover:text-[#005F6A]"
        strokeWidth={1.3}
        title="Zoom out"
      />

      <div className="px-2 py-1 app-title-small min-w-[3rem] text-center">
        {getZoomLabel()}
      </div>

      <IconButton
        icon={ZoomIn}
        size="md"
        variant="ghost"
        onClick={zoomIn}
        disabled={currentIndex === zoomLevels.length - 1}
        className="text-[#005F6A]/40 hover:text-[#005F6A]"
        strokeWidth={1.3}
        title="Zoom in"
      />

      <div className="w-px h-4 bg-[#005F6A]/10 mx-1" />

      <IconButton
        icon={RotateCcw}
        size="md"
        variant="ghost"
        onClick={resetZoom}
        className="text-[#005F6A]/40 hover:text-[#005F6A]"
        strokeWidth={1.3}
        title="Reset zoom"
      />
    </Card>
  );
}
