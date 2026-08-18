"use client";

import { useState } from "react";
import { Calendar, ChevronDown, ChevronUp } from "lucide-react";
import Card from "@/components/ui/Card";
import AvailabilityWeekGrid, {
  type AvailabilityGridRow,
} from "@/components/admin/AvailabilityWeekGrid";

/** Kept as a named export: this was the row type callers built against. */
export type AvailabilityOverviewRow = AvailabilityGridRow;

/**
 * Collapsible card wrapper around the shared availability grid.
 *
 * The TABLE moved to `@/components/admin/AvailabilityWeekGrid` in Stage 12 so
 * that /admin/availability could render the same rendering dated, rather than
 * growing a second grid that would drift from this one. This file is now only
 * the card, the toggle and the count.
 *
 * ONE caller left: the Field Lead's My Team page, group-scoped and expanded.
 * The Employees page retired its copy in the same stage — PDF #12 asks for one
 * central availability view, and two entry points to the same table is exactly
 * the divergence step 12.6 exists to close. It now links to /admin/availability
 * instead.
 *
 * `linkProfiles` is a PRIVACY prop, not a styling one: `/admin/employees/[id]`
 * is OWNER/ADMIN-only, so linking there from a Field Lead's view would advertise
 * a page that bounces them.
 */
export default function AvailabilityOverview({
  rows,
  defaultOpen = false,
  linkProfiles = true,
  title = "Availability overview",
}: {
  rows: AvailabilityOverviewRow[];
  defaultOpen?: boolean;
  linkProfiles?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (rows.length === 0) return null;

  return (
    <Card variant="default" className="p-5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 text-left">
        <span className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-[#008C9C]" />
          <span className="text-sm font-[600] text-gray-800">{title}</span>
          <span className="text-xs text-gray-400">
            {rows.length} cleaner{rows.length === 1 ? "" : "s"}
          </span>
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>

      {open && (
        <div className="mt-4">
          <AvailabilityWeekGrid rows={rows} linkProfiles={linkProfiles} />
        </div>
      )}
    </Card>
  );
}
