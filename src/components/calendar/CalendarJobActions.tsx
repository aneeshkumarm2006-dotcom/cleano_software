"use client";

import React, { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useCalendar } from "./CalendarContext";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Textarea from "@/components/ui/Textarea";
import { formatAddressLine } from "@/lib/client-address";
import {
  MapPin,
  Clock,
  DollarSign,
  LogIn,
  CheckCircle2,
  Camera,
  StickyNote,
  HelpCircle,
  AlertTriangle,
  ExternalLink,
  FileText,
} from "lucide-react";
import { markArrived } from "@/app/admin/actions/markArrived";
import { addJobNote } from "@/app/admin/actions/addJobNote";

const JOB_TYPE_LABELS: Record<string, string> = {
  R: "Residential",
  C: "Commercial",
  PC: "Post-Construction",
  F: "Follow-up",
};

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: "default" | "secondary" | "cleano" | "warning" | "error" }
> = {
  CREATED: { label: "Created", variant: "default" },
  SCHEDULED: { label: "Scheduled", variant: "secondary" },
  IN_PROGRESS: { label: "In Progress", variant: "warning" },
  COMPLETED: { label: "Completed", variant: "cleano" },
  PAID: { label: "Paid", variant: "cleano" },
  CANCELLED: { label: "Cancelled", variant: "error" },
};

export default function CalendarJobActions({
  isEmployee = true,
}: {
  isEmployee?: boolean;
}) {
  const {
    selectedEvent,
    showEventModal,
    setShowEventModal,
    setSelectedEvent,
    refreshEvents,
  } = useCalendar();
  const router = useRouter();

  // Admins land on the admin job view; cleaners on their own job page.
  const jobBasePath = isEmployee ? "/cleaners/my-jobs" : "/admin/jobs";

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [actionMessage, setActionMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const event = selectedEvent;
  const isJobEvent = !!event?.metadata?.jobId;

  const handleClose = useCallback(() => {
    setShowEventModal(false);
    setSelectedEvent(null);
    setShowNoteInput(false);
    setNoteText("");
    setActionMessage(null);
  }, [setShowEventModal, setSelectedEvent]);

  const handleMarkArrived = useCallback(async () => {
    if (!event?.metadata?.jobId) return;
    setActionLoading("arrived");
    setActionMessage(null);
    try {
      const result = await markArrived(event.metadata.jobId);
      if (result.success) {
        setActionMessage({ type: "success", text: "Marked as arrived!" });
        refreshEvents();
        setTimeout(handleClose, 1200);
      } else {
        setActionMessage({
          type: "error",
          text: result.error || "Failed to mark arrived",
        });
      }
    } catch {
      setActionMessage({ type: "error", text: "Something went wrong" });
    } finally {
      setActionLoading(null);
    }
  }, [event, refreshEvents, handleClose]);

  const handleAddNote = useCallback(async () => {
    if (!event?.metadata?.jobId || !noteText.trim()) return;
    setActionLoading("note");
    setActionMessage(null);
    try {
      const result = await addJobNote(event.metadata.jobId, noteText.trim());
      if (result.success) {
        setActionMessage({ type: "success", text: "Note added!" });
        setShowNoteInput(false);
        setNoteText("");
      } else {
        setActionMessage({
          type: "error",
          text: result.error || "Failed to add note",
        });
      }
    } catch {
      setActionMessage({ type: "error", text: "Something went wrong" });
    } finally {
      setActionLoading(null);
    }
  }, [event, noteText]);

  const handleViewDetails = useCallback(() => {
    if (!event?.metadata?.jobId) return;
    router.push(`${jobBasePath}/${event.metadata.jobId}`);
    handleClose();
  }, [event, router, handleClose, jobBasePath]);

  const handleUploadPhotos = useCallback(() => {
    if (!event?.metadata?.jobId) return;
    router.push(`${jobBasePath}/${event.metadata.jobId}#photos`);
    handleClose();
  }, [event, router, handleClose, jobBasePath]);

  const handleGetHelp = useCallback(() => {
    router.push("/admin/chat");
    handleClose();
  }, [router, handleClose]);

  const handleResolveEquipment = useCallback(() => {
    // Admin calendar → link straight to THAT cleaner's inventory (item 6), not
    // the cleaner-facing self-resolve page. Prefer an assigned cleaner; fall
    // back to the lead employee.
    const meta = event?.metadata as
      | { cleaners?: { id: string }[]; employeeId?: string }
      | undefined;
    const cleanerId = meta?.cleaners?.[0]?.id || meta?.employeeId;
    if (!cleanerId) return;
    router.push(`/admin/employees/${cleanerId}?tab=products`);
    handleClose();
  }, [event, router, handleClose]);

  if (!showEventModal || !event) return null;

  // For non-job events, don't render (let any existing event modal handle it)
  if (!isJobEvent) return null;

  const meta = event.metadata!;
  const status = meta.status as string;
  const statusConfig = STATUS_CONFIG[status] || STATUS_CONFIG.CREATED;
  const jobTypeLabel = meta.jobType
    ? JOB_TYPE_LABELS[meta.jobType] || meta.jobType
    : null;
  const hasMissingEquipment =
    meta.missingEquipment && meta.missingEquipment.length > 0;

  return (
    <Modal isOpen={true} onClose={handleClose} title={event.title}>
      <div className="space-y-4">
        {/* Job Info Header */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusConfig.variant} size="sm">
            {statusConfig.label}
          </Badge>
          {jobTypeLabel && (
            <Badge variant="cleano" size="sm">
              {jobTypeLabel}
            </Badge>
          )}
        </div>

        {/* Job Details */}
        <div className="space-y-2">
          {meta.location && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
              {/* Unit included (item 2) — dispatch needs it to tell two jobs in
                  the same building apart. */}
              <span>
                {formatAddressLine({
                  address: meta.location as string,
                  aptNumber: (meta.aptNumber as string | null) ?? null,
                })}
              </span>
            </div>
          )}
          {event.start && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Clock className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span>
                {/* event.start/end are floating Toronto wall-clock dates
                    (getJobsForDay → toBusinessWallClock); browser-local
                    formatting already shows business time. */}
                {event.start.toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                })}
                {event.end &&
                  ` - ${event.end.toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                  })}`}
              </span>
            </div>
          )}
          {meta.employeePay != null && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <DollarSign className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span className="font-[400]">
                ${Number(meta.employeePay).toFixed(2)}
              </span>
            </div>
          )}
          {meta.cleaners && meta.cleaners.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="text-gray-400 text-xs flex-shrink-0">Team:</span>
              <span>
                {meta.cleaners.map((c: any) => c.name).join(", ")}
              </span>
            </div>
          )}
        </div>

        {/* Equipment Warning */}
        {hasMissingEquipment && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-50 border border-yellow-200">
            <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-[400] text-yellow-800">
                Missing Equipment
              </p>
              <p className="text-xs text-yellow-600 mt-0.5">
                {meta.missingEquipment.length} item
                {meta.missingEquipment.length > 1 ? "s" : ""} needed for this
                job
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResolveEquipment}
                className="mt-1 !text-yellow-700 !text-xs !px-0">
                View cleaner inventory
                <ExternalLink className="w-3 h-3 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Action Message */}
        {actionMessage && (
          <div
            className={`p-3 rounded-lg text-sm ${
              actionMessage.type === "success"
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-red-50 text-red-700 border border-red-200"
            }`}>
            {actionMessage.text}
          </div>
        )}

        {/* Note Input */}
        {showNoteInput && (
          <div className="space-y-2">
            <Textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add a note about this job..."
              className="w-full"
            />
            <div className="flex gap-2 justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowNoteInput(false);
                  setNoteText("");
                }}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleAddNote}
                loading={actionLoading === "note"}
                disabled={!noteText.trim()}>
                Save Note
              </Button>
            </div>
          </div>
        )}

        {/* Quick Actions - Contextual based on status (cleaner-facing) */}
        {isEmployee && (
        <div className="border-t border-gray-100 pt-4">
          <p className="text-xs font-[450] text-gray-500 mb-2 uppercase tracking-wider">
            Quick Actions
          </p>
          <div className="grid grid-cols-2 gap-2">
            {/* SCHEDULED: Mark Arrived, Get Help */}
            {status === "SCHEDULED" && (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleMarkArrived}
                  loading={actionLoading === "arrived"}
                  className="justify-center">
                  <LogIn className="w-4 h-4 mr-1.5" />
                  Mark Arrived
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleGetHelp}
                  className="justify-center">
                  <HelpCircle className="w-4 h-4 mr-1.5" />
                  Get Help
                </Button>
              </>
            )}

            {/* CREATED: Get Help */}
            {status === "CREATED" && (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleMarkArrived}
                  loading={actionLoading === "arrived"}
                  className="justify-center">
                  <LogIn className="w-4 h-4 mr-1.5" />
                  Mark Arrived
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleGetHelp}
                  className="justify-center">
                  <HelpCircle className="w-4 h-4 mr-1.5" />
                  Get Help
                </Button>
              </>
            )}

            {/* IN_PROGRESS: Complete, Upload Photos, Add Notes, Get Help */}
            {status === "IN_PROGRESS" && (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleViewDetails}
                  className="justify-center">
                  <CheckCircle2 className="w-4 h-4 mr-1.5" />
                  Complete Job
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleUploadPhotos}
                  className="justify-center">
                  <Camera className="w-4 h-4 mr-1.5" />
                  Upload Photos
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowNoteInput(true)}
                  disabled={showNoteInput}
                  className="justify-center">
                  <StickyNote className="w-4 h-4 mr-1.5" />
                  Add Notes
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleGetHelp}
                  className="justify-center">
                  <HelpCircle className="w-4 h-4 mr-1.5" />
                  Get Help
                </Button>
              </>
            )}

            {/* COMPLETED: Upload Photos, Add Notes, View Summary */}
            {(status === "COMPLETED" || status === "PAID") && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleUploadPhotos}
                  className="justify-center">
                  <Camera className="w-4 h-4 mr-1.5" />
                  Upload Photos
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowNoteInput(true)}
                  disabled={showNoteInput}
                  className="justify-center">
                  <StickyNote className="w-4 h-4 mr-1.5" />
                  Add Notes
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleViewDetails}
                  className="justify-center col-span-2">
                  <FileText className="w-4 h-4 mr-1.5" />
                  View Summary
                </Button>
              </>
            )}
          </div>
        </div>
        )}

        {/* View Full Details Link */}
        <div className="border-t border-gray-100 pt-3">
          <Button
            variant="primary"
            size="sm"
            onClick={handleViewDetails}
            className="w-full justify-center">
            <ExternalLink className="w-4 h-4 mr-1.5" />
            {isEmployee ? "View Full Job Details" : "Open job details"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
