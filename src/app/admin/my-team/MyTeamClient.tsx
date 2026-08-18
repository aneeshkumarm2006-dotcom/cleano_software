"use client";

import { useMemo, useState } from "react";
import {
  CalendarDays,
  CalendarClock,
  Users,
  MapPin,
  Mail,
  Phone,
  Eye,
} from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import AvailabilityOverview from "../employees/AvailabilityOverview";
import type { MyTeamDTO, TeamJobDTO } from "../actions/getMyTeam.types";

type TabId = "schedule" | "members" | "availability";

/** Human label for a raw Job.status. */
const STATUS_LABEL: Record<string, string> = {
  CREATED: "Unconfirmed",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  PAID: "Completed",
  CANCELLED: "Cancelled",
};

/**
 * Status → Badge variant. `PAID` deliberately reads as "Completed" here: the
 * distinction between the two is whether the CLIENT HAS PAID, which is exactly
 * the kind of payment state this view must not report (see getMyTeam.types.ts).
 */
function statusVariant(
  status: string
): "default" | "success" | "warning" | "cleano" {
  if (status === "IN_PROGRESS") return "cleano";
  if (status === "COMPLETED" || status === "PAID") return "success";
  if (status === "CREATED") return "warning";
  return "default";
}

const TIER_LABEL: Record<string, string> = {
  TRAINEE: "Trainee",
  STANDARD: "Standard",
  FIELD_LEAD: "Field Lead",
};

function JobRow({ job }: { job: TeamJobDTO }) {
  const time = job.startLabel
    ? job.endLabel
      ? `${job.startLabel} – ${job.endLabel}`
      : job.startLabel
    : "Time TBD";

  return (
    <div
      className={`flex flex-wrap items-start gap-x-3 gap-y-1.5 px-3 py-2.5 rounded-xl ${
        job.isMine ? "bg-[#008C9C]/[0.06]" : ""
      }`}>
      <span className="text-xs font-[600] text-gray-800 tabular-nums min-w-[112px]">
        {time}
      </span>
      <span className="text-sm text-gray-800 font-[500]">
        {job.clientFirstName}
      </span>
      {job.serviceType && (
        <span className="text-xs text-gray-600">{job.serviceType}</span>
      )}
      {job.area && (
        <span className="inline-flex items-center gap-1 text-xs text-gray-600">
          <MapPin className="w-3 h-3" aria-hidden="true" />
          {job.area}
        </span>
      )}
      <span className="ml-auto flex items-center gap-2">
        {job.isMine && (
          <Badge variant="cleano" size="xs">
            You
          </Badge>
        )}
        <Badge variant={statusVariant(job.status)} size="xs">
          {STATUS_LABEL[job.status] ?? job.status}
        </Badge>
      </span>
      <div className="w-full text-xs text-gray-600">
        {job.cleanerNames.length > 0 ? (
          <span>Crew: {job.cleanerNames.join(", ")}</span>
        ) : (
          <span className="text-amber-700">No cleaner assigned yet</span>
        )}
        {job.notes ? (
          <span className="block mt-0.5 text-gray-500">{job.notes}</span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The Field Lead's group view: who is in the group, what they are working over
 * the next fortnight, and when each of them is available.
 *
 * There is nothing to save on this screen — every control is a filter or a tab.
 */
export default function MyTeamClient({ team }: { team: MyTeamDTO }) {
  const [tab, setTab] = useState<TabId>("schedule");
  // Empty days are hidden by default: over a fortnight most of the list is
  // whitespace otherwise, and the horizon is stated in the subtitle either way.
  const [showEmptyDays, setShowEmptyDays] = useState(false);
  const [memberFilter, setMemberFilter] = useState<string>("all");

  const crewCount = team.members.filter((m) => !m.isLead).length;
  const memberName = useMemo(
    () => new Map(team.members.map((m) => [m.id, m.name])),
    [team.members]
  );

  const days = useMemo(() => {
    const selected =
      memberFilter === "all" ? null : memberName.get(memberFilter) ?? null;
    return team.days
      .map((day) => ({
        ...day,
        // Filtering by NAME, because the payload deliberately carries crew names
        // rather than crew ids — a lead needs to read the roster, not join on it.
        jobs: selected
          ? day.jobs.filter((j) => j.cleanerNames.includes(selected))
          : day.jobs,
      }))
      .filter((day) => showEmptyDays || day.jobs.length > 0);
  }, [team.days, memberFilter, memberName, showEmptyDays]);

  const totalJobs = useMemo(
    () => days.reduce((sum, d) => sum + d.jobs.length, 0),
    [days]
  );

  const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
    { id: "schedule", label: "Group schedule", icon: <CalendarDays size={15} /> },
    { id: "members", label: "Members", icon: <Users size={15} /> },
    {
      id: "availability",
      label: "Availability",
      icon: <CalendarClock size={15} />,
    },
  ];

  return (
    <div className="admin-font h-full overflow-hidden overflow-y-auto p-8 stack-24">
      <header className="stack-8">
        <p className="eyebrow">Staff</p>
        <h1 className="display">
          My Team <em>schedule.</em>
        </h1>
        <p className="subtitle">
          {crewCount === 0
            ? "No cleaners are assigned to your group yet — an admin sets this from the Employees page."
            : `${crewCount} ${
                crewCount === 1 ? "cleaner" : "cleaners"
              } in your group · next ${team.horizonDays} days`}
        </p>
      </header>

      {team.viewingAsAdmin && (
        <Card variant="alert" className="p-4" border>
          <p className="flex items-center gap-2 text-sm">
            <Eye className="w-4 h-4 shrink-0" aria-hidden="true" />
            Viewing <strong>{team.leadName}</strong>&apos;s team as an admin.
            This is exactly what that Field Lead sees — no pricing, payroll or
            payment data.
          </p>
        </Card>
      )}

      <div className="atabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`atab${tab === t.id ? " active" : ""}`}
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}>
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {t.icon}
              {t.label}
            </span>
          </button>
        ))}
      </div>

      {tab === "schedule" && (
        <div className="stack-24">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <span className="font-[600]">Cleaner</span>
              <select
                value={memberFilter}
                onChange={(e) => setMemberFilter(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-800">
                <option value="all">Everyone in the group</option>
                {team.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.isLead ? `${m.name} (you)` : m.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={showEmptyDays}
                onChange={(e) => setShowEmptyDays(e.target.checked)}
              />
              Show days with no jobs
            </label>
            <span className="ml-auto text-xs text-gray-500">
              {totalJobs} {totalJobs === 1 ? "job" : "jobs"}
            </span>
          </div>

          {days.length === 0 ? (
            <div className="dcard" style={{ padding: 20 }}>
              <p className="text-sm text-gray-600">
                Nothing scheduled for your group in the next {team.horizonDays}{" "}
                days.
              </p>
            </div>
          ) : (
            <div className="stack-24">
              {days.map((day) => (
                <div key={day.dateKey} className="dcard" style={{ padding: 12 }}>
                  <div className="flex items-center gap-2 px-1 pb-2">
                    <h3 className="text-sm font-[600] text-gray-800">
                      {day.label}
                    </h3>
                    {day.isToday && (
                      <Badge variant="cleano" size="xs">
                        Today
                      </Badge>
                    )}
                    <span className="ml-auto text-xs text-gray-500">
                      {day.jobs.length}{" "}
                      {day.jobs.length === 1 ? "job" : "jobs"}
                    </span>
                  </div>
                  {day.jobs.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-gray-500">
                      No jobs scheduled.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {day.jobs.map((job) => (
                        <JobRow key={job.id} job={job} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "members" && (
        <div className="dcard" style={{ padding: 12 }}>
          {team.members.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-600">
              No members in this group.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {team.members.map((m) => (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 rounded-xl hover:bg-black/[0.02]">
                  <span className="text-sm font-[500] text-gray-800">
                    {m.name}
                  </span>
                  {m.isLead && (
                    <Badge variant="cleano" size="xs">
                      You · lead
                    </Badge>
                  )}
                  <Badge variant="default" size="xs">
                    {TIER_LABEL[m.cleanerTier] ?? m.cleanerTier}
                  </Badge>
                  {!m.isActive && (
                    <Badge variant="warning" size="xs">
                      Deactivated
                    </Badge>
                  )}
                  <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
                    <a
                      href={`mailto:${m.email}`}
                      className="inline-flex items-center gap-1 hover:underline">
                      <Mail className="w-3 h-3" aria-hidden="true" />
                      {m.email}
                    </a>
                    {m.phone && (
                      <a
                        href={`tel:${m.phone}`}
                        className="inline-flex items-center gap-1 hover:underline">
                        <Phone className="w-3 h-3" aria-hidden="true" />
                        {m.phone}
                      </a>
                    )}
                    <span>
                      {m.upcomingJobCount}{" "}
                      {m.upcomingJobCount === 1 ? "job" : "jobs"} ·{" "}
                      {team.horizonDays}d
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "availability" && (
        <div className="stack-24">
          {team.availability.length === 0 ? (
            <div className="dcard" style={{ padding: 20 }}>
              <p className="text-sm text-gray-600">
                No availability to show for this group.
              </p>
            </div>
          ) : (
            <>
              {/* Same table the Employees page uses, scoped to the group and
                  expanded — here it IS the tab's content. Names render as plain
                  text: /admin/employees/[id] is OWNER/ADMIN-only, so linking
                  there would advertise a page that bounces a Field Lead. */}
              <AvailabilityOverview
                rows={team.availability}
                defaultOpen
                linkProfiles={false}
                title="Weekly availability"
              />
              <p className="text-xs text-gray-500">
                Blocked dates (vacation, appointments, sick days) always beat the
                weekly hours. Availability is read-only here — ask an admin to
                change it.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
