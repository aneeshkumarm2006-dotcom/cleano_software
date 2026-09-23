"use client";

// The one job that is actually next.
//
// The list opened on a search box and three dropdowns, so a cleaner checking
// their phone before leaving the house met controls first and had to scroll
// past them to find out where they were going. Every row looked the same, so
// today's nine o'clock read exactly like one three weeks out.
//
// This lifts the next job out of the list and states the two things somebody
// standing on a doorstep needs: when, and where. Everything else stays a row.

import Link from "next/link";
import { MapPin, Navigation, Clock } from "lucide-react";

import { fmtDate, fmtTime } from "@/lib/time";
import { jobTypeLabel } from "@/lib/calendar-labels";
import { storeTzLabel } from "@/lib/timezone";

/** "in 3 hours" / "in 25 minutes" / "tomorrow" — how soon, in words. */
function untilText(start: Date, now: Date): string {
  const mins = Math.round((start.getTime() - now.getTime()) / 60000);
  if (mins <= 0) return "now";
  if (mins < 60) return `in ${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

export default function NextJobCard({
  job,
  serviceLabels,
}: {
  job: {
    id: string;
    clientName: string;
    jobDate?: string | Date | null;
    startTime?: string | Date | null;
    location?: string | null;
    jobType?: string | null;
    jobNumber?: number | null;
  };
  serviceLabels?: Record<string, string>;
}) {
  const start = job.startTime ? new Date(job.startTime) : null;
  if (!start || Number.isNaN(start.getTime())) return null;

  const now = new Date();
  const dayPart = fmtDate(start, { weekday: "short", month: "short", day: "numeric" });
  const isToday = fmtDate(start, { dateStyle: undefined, day: "numeric", month: "short" }) ===
    fmtDate(now, { dateStyle: undefined, day: "numeric", month: "short" });
  const street = (job.location ?? "").split(",")[0] || job.location || null;
  const service = jobTypeLabel(job.jobType ?? null, serviceLabels);

  return (
    <section className="cl-next" aria-label="Your next job">
      <div className="cl-next-eyebrow">
        Next job
        <span>· {untilText(start, now)}</span>
      </div>

      <div className="cl-next-card">
        {/* When, first and largest. A cleaner checks this to decide whether to
            leave now, not to read a schedule. */}
        <div className="cl-next-when">
          {isToday ? "Today" : dayPart}, {fmtTime(start)}
        </div>
        <div className="cl-next-whensub">
          <Clock size={12} aria-hidden="true" /> {storeTzLabel(start)}
        </div>

        <div className="cl-next-who">{job.clientName}</div>
        {street && (
          <div className="cl-next-where">
            <MapPin size={12} aria-hidden="true" /> {street}
          </div>
        )}

        <div className="cl-next-chips">
          {job.jobNumber != null && <span className="cl-next-chip">Job #{job.jobNumber}</span>}
          {service && <span className="cl-next-chip">{service}</span>}
        </div>

        <div className="cl-next-cta">
          <Link href={`/cleaners/my-jobs/${job.id}`} className="cl-next-btn">
            Open job
          </Link>
          {job.location && (
            <a
              className="cl-next-btn ghost"
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.location)}`}
              target="_blank"
              rel="noopener noreferrer">
              <Navigation size={14} aria-hidden="true" /> Directions
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
