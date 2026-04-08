"use client";

import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { Calendar, Clock, MapPin, DollarSign } from "lucide-react";

interface JobRowProps {
  job: any;
  isMainEmployee: boolean;
}

export function JobRow({ job, isMainEmployee }: JobRowProps) {
  const jobWithClock = job as any;
  const canClockIn = !jobWithClock.clockInTime && job.status !== "COMPLETED";
  const canClockOut = jobWithClock.clockInTime && !jobWithClock.clockOutTime;
  const isCompleted = job.status === "COMPLETED" || jobWithClock.clockOutTime;

  const duration =
    jobWithClock.clockInTime && jobWithClock.clockOutTime
      ? Math.round(
          (new Date(jobWithClock.clockOutTime).getTime() -
            new Date(jobWithClock.clockInTime).getTime()) /
            1000 /
            60
        )
      : null;

  return (
    <div className="flex hover:bg-gray-50/50 transition-colors items-center min-w-max">
      {/* Client Name */}
      <div className="px-6 py-4 flex items-center w-[200px] min-w-[200px]">
        <span className="text-sm font-[400] text-gray-900 truncate">
          {job.clientName}
        </span>
      </div>

      {/* Location */}
      <div className="px-6 py-4 flex items-center w-[220px] min-w-[220px]">
        {job.location ? (
          <span className="text-sm text-gray-600 flex items-center gap-1.5 truncate">
            <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            <span className="truncate">{job.location}</span>
          </span>
        ) : (
          <span className="text-gray-400">-</span>
        )}
      </div>

      {/* Date */}
      <div className="px-6 py-4 flex items-center w-[140px] min-w-[140px]">
        {job.jobDate ? (
          <span className="text-sm text-gray-900 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            {new Date(job.jobDate).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </span>
        ) : (
          <span className="text-gray-400">-</span>
        )}
      </div>

      {/* Start Time */}
      <div className="px-6 py-4 flex items-center w-[140px] min-w-[140px]">
        <span className="text-sm text-gray-900 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          {new Date(job.startTime).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          })}
        </span>
      </div>

      {/* Scheduled End Time */}
      <div className="px-6 py-4 flex items-center w-[140px] min-w-[140px]">
        {job.endTime ? (
          <span className="text-sm text-gray-600">
            {new Date(job.endTime).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            })}
          </span>
        ) : (
          <span className="text-gray-400">-</span>
        )}
      </div>

      {/* Actual End Time (Clock Out) */}
      <div className="px-6 py-4 flex items-center w-[150px] min-w-[150px]">
        {jobWithClock.clockOutTime ? (
          <span className="text-sm font-[400] text-green-600">
            {new Date(jobWithClock.clockOutTime).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            })}
          </span>
        ) : jobWithClock.clockInTime ? (
          <span className="text-xs text-blue-600">In Progress</span>
        ) : (
          <span className="text-gray-400">-</span>
        )}
      </div>

      {/* Status */}
      <div className="px-6 py-4 flex flex-col justify-center gap-1 w-[200px] min-w-[200px]">
        <Badge
          variant={
            job.status === "COMPLETED"
              ? "cleano"
              : job.status === "IN_PROGRESS"
              ? "secondary"
              : "default"
          }
          size="sm"
          className="!w-fit">
          {job.status.replace("_", " ")}
        </Badge>
      </div>

      {/* Actions */}
      <div className="px-6 py-4 text-right text-sm flex items-center justify-end gap-2 w-[160px] min-w-[160px]">
        <Button
          variant="primary"
          size="sm"
          submit={false}
          href={`/my-jobs/${job.id}`}>
          {canClockIn
            ? "Start Job"
            : canClockOut
            ? "Complete Job"
            : "View Details"}
        </Button>
      </div>
    </div>
  );
}
