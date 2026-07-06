"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, MapPin, Clock } from "lucide-react";
import PayBreakdownModal from "./PayBreakdownModal";
import { fmtDate, fmtTime } from "@/lib/time";

interface MissingEquipmentInfo {
  productId: string;
  productName: string;
  needed: number;
  have: number;
}

interface JobRowProps {
  job: any;
  isMainEmployee: boolean;
  missingEquipment?: MissingEquipmentInfo[];
}

function statusClass(status: string) {
  switch (status) {
    case "COMPLETED": return "completed";
    case "SCHEDULED": return "scheduled";
    case "IN_PROGRESS": return "inprogress";
    case "CANCELLED": return "cancelled";
    case "PAID": return "paid";
    default: return "created";
  }
}

function jobTypeLabel(type: string | null) {
  if (!type) return null;
  switch (type) {
    case "R": return "Residential";
    case "C": return "Commercial";
    case "PC": return "Post-Construction";
    case "F": return "Follow-up";
    default: return type;
  }
}

export function JobRow({ job, isMainEmployee, missingEquipment = [] }: JobRowProps) {
  const router = useRouter();
  const jobWithClock = job as any;
  const canClockIn = !jobWithClock.clockInTime && !["COMPLETED", "CANCELLED", "PAID"].includes(job.status);
  const canClockOut = jobWithClock.clockInTime && !jobWithClock.clockOutTime;
  const isCompleted = job.status === "COMPLETED" || job.status === "PAID" || jobWithClock.clockOutTime;
  const instantPayoutEligible = job.status === "COMPLETED" && job.paymentReceived === true;

  const [payModalOpen, setPayModalOpen] = useState(false);

  const ctaLabel = canClockIn ? "Start job" : canClockOut ? "Complete job" : "View details";
  const sc = statusClass(job.status);

  // Render the job date in the business timezone so a date-only value stored at
  // UTC midnight does not roll back a day (fixes the "one day early" list bug).
  const date = job.jobDate ? new Date(job.jobDate) : null;
  const mo = date ? fmtDate(date, { month: "short" }).toUpperCase() : null;
  const day = date ? fmtDate(date, { day: "numeric" }) : null;
  const wd = date ? fmtDate(date, { weekday: "short" }).toUpperCase() : null;

  return (
    <>
      <div
        className={`cl-jobs2-card ${sc}`}
        onClick={() => router.push(`/cleaners/my-jobs/${job.id}`)}>
        {/* Date pill */}
        <div className="cl-jobs2-datepill">
          {mo && <span className="mo">{mo}</span>}
          {day && <span className="day">{day}</span>}
          {wd && <span className="wd">{wd}</span>}
          {!date && <span className="mo" style={{ fontSize: 12 }}>—</span>}
        </div>

        {/* Meta */}
        <div className="cl-jobs2-meta">
          <div className="cl-jobs2-meta-head">
            <span className="cl-jobs2-client">{job.clientName}</span>
            <span className={`cl-pill ${sc}`}>{job.status.replace(/_/g, " ")}</span>
            {jobTypeLabel(job.jobType) && (
              <span className="cl-pill" style={{ background: "var(--primary-5)", color: "var(--primary)" }}>
                {jobTypeLabel(job.jobType)}
              </span>
            )}
            {instantPayoutEligible && (
              <span className="cl-pill" style={{ background: "#fef3c7", color: "#b45309" }}>Instant payout</span>
            )}
            {missingEquipment.length > 0 && (
              <button
                type="button"
                className="cl-job-card-warn"
                onClick={(e) => { e.stopPropagation(); router.push(`/cleaners/my-inventory/resolve?jobId=${job.id}`); }}>
                <AlertTriangle size={11} />
                Missing equipment
              </button>
            )}
          </div>
          <div className="cl-jobs2-meta-rows">
            {job.location && (
              <span className="row">
                <MapPin size={13} className="icon" />
                <span className="txt">{job.location}</span>
              </span>
            )}
            {job.startTime && (
              <span className="row">
                <Clock size={13} className="icon" />
                {fmtTime(job.startTime)}
                {job.endTime && <> – {fmtTime(job.endTime)}</>}
              </span>
            )}
          </div>
        </div>

        {/* Side: pay + CTA */}
        <div className="cl-jobs2-side">
          {job.employeePay != null && isMainEmployee && (
            <button
              type="button"
              className="cl-jobs2-pay"
              onClick={(e) => { e.stopPropagation(); setPayModalOpen(true); }}>
              <span className="lbl">{isCompleted ? "Earned" : "Est. pay"}</span>
              ${Number(job.employeePay).toFixed(2)}
            </button>
          )}
          <a
            href={`/cleaners/my-jobs/${job.id}`}
            className={`cl-jobs2-cta${isCompleted ? " solid" : ""}`}
            onClick={(e) => e.stopPropagation()}>
            {ctaLabel}
          </a>
        </div>
      </div>

      <PayBreakdownModal
        jobId={job.id}
        isOpen={payModalOpen}
        onClose={() => setPayModalOpen(false)}
      />
    </>
  );
}
