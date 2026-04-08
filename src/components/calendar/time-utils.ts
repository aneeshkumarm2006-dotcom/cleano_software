import { useMemo } from "react";
import { isSameDay } from "./utils";
import { OfficeHours } from "./calendar-helpers";

export function useTimezoneLabel() {
  return useMemo(() => {
    const offset = -new Date().getTimezoneOffset();
    const hours = Math.floor(Math.abs(offset) / 60);
    const sign = offset >= 0 ? "+" : "-";
    return `GMT${sign}${hours}`;
  }, []);
}

export function getCurrentTimeMeta(
  currentTime: Date,
  officeHours: OfficeHours | null,
  zoomLevel: number,
  opts: { days?: Date[]; day?: Date }
) {
  const hour = currentTime.getHours();
  const minute = currentTime.getMinutes();
  const officeStart = officeHours?.start || 0;

  const isWithinOfficeHours =
    !officeHours || (hour >= officeHours.start && hour <= officeHours.end);

  const matchesDay =
    (opts.day && isSameDay(opts.day, currentTime)) ||
    (opts.days && opts.days.some((d) => isSameDay(d, currentTime)));

  const show = matchesDay && isWithinOfficeHours;
  const top =
    (hour - officeStart) * zoomLevel + (minute * zoomLevel) / 60;

  return { show, top };
}

