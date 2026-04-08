"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, Resolver, SubmitHandler, useForm } from "react-hook-form";
import {
  X,
  Briefcase,
  Loader,
  Trash2,
  DollarSign,
  MapPin,
  FileText,
  AlertTriangle,
  Calendar,
  Users,
  ChevronRight,
  ChevronLeft,
  Check,
  ChevronDown,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import CustomDropdown from "@/components/ui/custom-dropdown";
import SmartSearch from "@/components/SmartSearch";

interface User {
  id: string;
  name: string;
  email: string;
}

interface Job {
  id: string;
  clientName: string;
  location: string | null;
  description: string | null;
  jobType: string | null;
  jobDate: string | null;
  startTime: string;
  endTime: string | null;
  price: number | null;
  employeePay: number | null;
  totalTip: number | null;
  parking: number | null;
  notes: string | null;
  cleaners: Array<{ id: string; name: string }>;
}

interface JobModalProps {
  isOpen: boolean;
  onClose: () => void;
  job?: Job | null;
  mode: "create" | "edit";
  users: User[];
  onSubmit: (data: FormData) => Promise<{ success?: boolean; error?: string }>;
  onDelete?: (jobId: string) => Promise<{ success?: boolean; error?: string }>;
}

const formSchema = z.object({
  clientName: z.string().min(1, "Client name is required"),
  location: z.string().optional(),
  description: z.string().optional(),
  jobType: z.string().optional(),
  startDate: z.string().optional(),
  startTime: z.string().optional(),
  endDate: z.string().optional(),
  endTime: z.string().optional(),
  price: z.union([z.coerce.number().min(0), z.literal("")]).optional(),
  employeePay: z.union([z.coerce.number().min(0), z.literal("")]).optional(),
  totalTip: z.union([z.coerce.number().min(0), z.literal("")]).optional(),
  parking: z.union([z.coerce.number().min(0), z.literal("")]).optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

const jobTypes = [
  { value: "", label: "Select type" },
  { value: "R", label: "Residential" },
  { value: "C", label: "Commercial" },
  { value: "PC", label: "Post-Construction" },
  { value: "F", label: "Follow-up" },
];

const STEPS = [
  { id: 1, title: "Basic Info", icon: Briefcase },
  { id: 2, title: "Schedule & Team", icon: Calendar },
  { id: 3, title: "Pricing & Notes", icon: DollarSign },
];

type CustomDatePickerProps = {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

const toISODate = (year: number, month: number, day: number) =>
  `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(
    2,
    "0"
  )}`;

function CustomDatePicker({
  label,
  value,
  onChange,
  placeholder = "Select date",
  disabled,
}: CustomDatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [viewDate, setViewDate] = useState<Date>(
    value ? new Date(`${value}T00:00:00`) : new Date()
  );
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        pickerRef.current &&
        !pickerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (value) {
      setViewDate(new Date(`${value}T00:00:00`));
    }
  }, [value]);

  useEffect(() => {
    if (isOpen && pickerRef.current) {
      const rect = pickerRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
      });
    }
  }, [isOpen]);

  const selectedDate = value ? new Date(`${value}T00:00:00`) : null;
  const monthLabel = viewDate.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const startDay = new Date(
    viewDate.getFullYear(),
    viewDate.getMonth(),
    1
  ).getDay();
  const daysInMonth = new Date(
    viewDate.getFullYear(),
    viewDate.getMonth() + 1,
    0
  ).getDate();
  const today = new Date();

  const handleSelectDay = (day: number) => {
    const isoDate = toISODate(viewDate.getFullYear(), viewDate.getMonth(), day);
    onChange(isoDate);
    setIsOpen(false);
  };

  const handleToday = () => {
    const isoDate = toISODate(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );
    setViewDate(today);
    onChange(isoDate);
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange("");
    setIsOpen(false);
  };

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  return (
    <div className="space-y-2 relative" ref={pickerRef}>
      <label className="input-label tracking-tight">{label}</label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        className={`w-full px-4 py-3 rounded-2xl border border-[#005F6A]/15 bg-[#005F6A]/5 flex items-center justify-between text-left transition-all tracking-tight ${
          disabled
            ? "opacity-60 cursor-not-allowed"
            : "hover:border-[#005F6A]/40"
        }`}>
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center border border-[#005F6A]/15">
            <Calendar className="w-4 h-4 text-[#005F6A]" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-xs text-[#005F6A]/70">Selected date</span>
            <span
              className={`text-sm font-[450] ${
                value ? "text-[#005F6A]" : "text-[#005F6A]/50"
              }`}>
              {value
                ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : placeholder}
            </span>
          </div>
        </div>
        <ChevronDown className="w-4 h-4 text-[#005F6A]/60 flex-shrink-0" />
      </button>

      {isOpen && (
        <div
          className="fixed z-[9999] w-full max-w-sm rounded-2xl bg-white shadow-xl border border-[#005F6A]/10 p-4"
          style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              className="p-2 rounded-lg hover:bg-[#005F6A]/10 text-[#005F6A]"
              onClick={() =>
                setViewDate(
                  new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1)
                )
              }>
              <ChevronLeft className="w-4 h-4" />
            </button>
            <p className="text-sm font-[600] text-[#005F6A] tracking-tight">
              {monthLabel}
            </p>
            <button
              type="button"
              className="p-2 rounded-lg hover:bg-[#005F6A]/10 text-[#005F6A]"
              onClick={() =>
                setViewDate(
                  new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1)
                )
              }>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 text-[11px] text-[#005F6A]/60 mb-2 tracking-tight">
            {["S", "M", "T", "W", "T", "F", "S"].map((day) => (
              <div key={day} className="text-center py-1">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: startDay }).map((_, index) => (
              <div key={`empty-${index}`} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, index) => {
              const day = index + 1;
              const candidate = new Date(
                viewDate.getFullYear(),
                viewDate.getMonth(),
                day
              );
              const isSelected =
                !!selectedDate && isSameDay(selectedDate, candidate);
              const isToday = isSameDay(today, candidate);

              return (
                <button
                  type="button"
                  key={day}
                  onClick={() => handleSelectDay(day)}
                  className={`h-10 rounded-xl text-sm font-[450] transition-all tracking-tight ${
                    isSelected
                      ? "bg-[#005F6A] text-white shadow-sm"
                      : "hover:bg-[#005F6A]/10 text-[#005F6A]"
                  } ${
                    isToday && !isSelected ? "border border-[#005F6A]/30" : ""
                  }`}>
                  {day}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between mt-3 gap-2">
            <button
              type="button"
              className="flex-1 px-3 py-2 rounded-xl bg-[#005F6A]/10 text-[#005F6A] text-sm font-[500] tracking-tight hover:bg-[#005F6A]/15"
              onClick={handleToday}>
              Today
            </button>
            <button
              type="button"
              className="flex-1 px-3 py-2 rounded-xl bg-white border border-[#005F6A]/20 text-[#005F6A]/80 text-sm font-[500] tracking-tight hover:border-[#005F6A]/40"
              onClick={handleClear}>
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type CustomTimePickerProps = {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

function CustomTimePicker({
  label,
  value,
  onChange,
  placeholder = "Select time",
  disabled,
}: CustomTimePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        pickerRef.current &&
        !pickerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && pickerRef.current) {
      const rect = pickerRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
      });
    }
  }, [isOpen]);

  const generateTimeOptions = () => {
    const options = [];
    for (let hour = 0; hour < 24; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        const timeString = `${String(hour).padStart(2, "0")}:${String(
          minute
        ).padStart(2, "0")}`;
        options.push(timeString);
      }
    }
    return options;
  };

  const timeOptions = generateTimeOptions();

  const formatTimeDisplay = (time: string) => {
    if (!time) return "";
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const handleTimeSelect = (time: string) => {
    onChange(time);
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange("");
    setIsOpen(false);
  };

  return (
    <div className="space-y-2 relative" ref={pickerRef}>
      <label className="input-label tracking-tight">{label}</label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        className={`w-full px-4 py-3 rounded-2xl border border-[#005F6A]/15 bg-[#005F6A]/5 flex items-center justify-between text-left transition-all tracking-tight ${
          disabled
            ? "opacity-60 cursor-not-allowed"
            : "hover:border-[#005F6A]/40"
        }`}>
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center border border-[#005F6A]/15">
            <Calendar className="w-4 h-4 text-[#005F6A]" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-xs text-[#005F6A]/70">Selected time</span>
            <span
              className={`text-sm font-[450] ${
                value ? "text-[#005F6A]" : "text-[#005F6A]/50"
              }`}>
              {value ? formatTimeDisplay(value) : placeholder}
            </span>
          </div>
        </div>
        <ChevronDown className="w-4 h-4 text-[#005F6A]/60 flex-shrink-0" />
      </button>

      {isOpen && (
        <div
          className="fixed z-[9999] w-full max-w-sm rounded-2xl bg-white shadow-xl border border-[#005F6A]/10 max-h-64 overflow-y-auto"
          style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
          <div className="p-2">
            <div className="flex gap-2 mb-2">
              <button
                type="button"
                className="flex-1 px-3 py-2 rounded-xl bg-[#005F6A] text-white text-sm font-[500] tracking-tight hover:bg-[#005F6A]/90"
                onClick={() =>
                  handleTimeSelect(new Date().toTimeString().slice(0, 5))
                }>
                Now
              </button>
              <button
                type="button"
                className="flex-1 px-3 py-2 rounded-xl bg-white border border-[#005F6A]/20 text-[#005F6A]/80 text-sm font-[500] tracking-tight hover:border-[#005F6A]/40"
                onClick={handleClear}>
                Clear
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {timeOptions.map((time) => (
                <button
                  key={time}
                  type="button"
                  onClick={() => handleTimeSelect(time)}
                  className={`px-3 py-2 rounded-lg text-sm font-[450] tracking-tight transition-all ${
                    value === time
                      ? "bg-[#005F6A] text-white"
                      : "bg-[#005F6A]/5 text-[#005F6A] hover:bg-[#005F6A]/10"
                  }`}>
                  {formatTimeDisplay(time)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function JobModal({
  isOpen,
  onClose,
  job,
  mode,
  users,
  onSubmit,
  onDelete,
}: JobModalProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedCleaners, setSelectedCleaners] = useState<string[]>([]);
  const [selectedJobType, setSelectedJobType] = useState<string>("");

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    trigger,
    control,
  } = useForm<FormValues>({
    resolver: (zodResolver as any)(formSchema) as Resolver<FormValues>,
    mode: "onChange",
  });

  // Initialize form when modal opens or job changes
  useEffect(() => {
    if (isOpen) {
      setCurrentStep(1);
      if (job) {
        reset({
          clientName: job.clientName || "",
          location: job.location || "",
          description: job.description || "",
          jobType: job.jobType || "",
          startDate: job.startTime
            ? new Date(job.startTime).toISOString().split("T")[0]
            : "",
          startTime: job.startTime
            ? new Date(job.startTime).toISOString().split("T")[1].slice(0, 5)
            : "",
          endDate: job.endTime
            ? new Date(job.endTime).toISOString().split("T")[0]
            : "",
          endTime: job.endTime
            ? new Date(job.endTime).toISOString().split("T")[1].slice(0, 5)
            : "",
          price: job.price || "",
          employeePay: job.employeePay || "",
          totalTip: job.totalTip || "",
          parking: job.parking || "",
          notes: job.notes || "",
        });
        setSelectedCleaners(job.cleaners?.map((c) => c.id) || []);
        setSelectedJobType(job.jobType || "");
      } else {
        reset({
          clientName: "",
          location: "",
          description: "",
          jobType: "",
          startDate: "",
          startTime: "",
          endDate: "",
          endTime: "",
          price: "",
          employeePay: "",
          totalTip: "",
          parking: "",
          notes: "",
        });
        setSelectedCleaners([]);
        setSelectedJobType("");
      }
    }
  }, [isOpen, job, reset]);

  const disableForm = submitting || isDeleting;

  // Step validation
  const validateStep = async (step: number): Promise<boolean> => {
    if (step === 1) {
      return await trigger("clientName");
    }
    return true;
  };

  const handleNextStep = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const isValid = await validateStep(currentStep);
    if (isValid && currentStep < 3) {
      setCurrentStep(currentStep + 1);
      setGlobalError(null);
    }
  };

  const handlePrevStep = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
      setGlobalError(null);
    }
  };

  const goToStep = async (step: number) => {
    if (step < currentStep) {
      setCurrentStep(step);
      setGlobalError(null);
    } else if (step > currentStep) {
      // Validate all steps up to the target step
      for (let i = currentStep; i < step; i++) {
        const isValid = await validateStep(i);
        if (!isValid) return;
      }
      setCurrentStep(step);
      setGlobalError(null);
    }
  };

  // Transform users to SmartSearch format
  const smartSearchUsers = users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
  }));

  const toggleCleaner = (userId: string) => {
    setSelectedCleaners((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  };

  const handleFormSubmit: SubmitHandler<FormValues> = async (values) => {
    setSubmitting(true);
    setGlobalError(null);
    setSuccessMessage(null);

    try {
      const formData = new FormData();
      if (job?.id) formData.append("jobId", job.id);
      formData.append("clientName", values.clientName);
      formData.append("location", values.location || "");
      formData.append("description", values.description || "");
      formData.append("jobType", selectedJobType);
      formData.append("startDate", values.startDate || "");
      formData.append("startTime", values.startTime || "");
      formData.append("endDate", values.endDate || "");
      formData.append("endTime", values.endTime || "");
      formData.append("price", String(values.price || ""));
      formData.append("employeePay", String(values.employeePay || ""));
      formData.append("totalTip", String(values.totalTip || ""));
      formData.append("parking", String(values.parking || ""));
      formData.append("notes", values.notes || "");

      // Add cleaners
      selectedCleaners.forEach((id) => {
        formData.append("cleaners", id);
      });

      const result = await onSubmit(formData);

      if (result.error) {
        throw new Error(result.error);
      }

      setSuccessMessage(
        mode === "create"
          ? "Job created successfully"
          : "Job updated successfully"
      );

      setTimeout(() => {
        handleClose();
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error("Submit error:", error);
      setGlobalError(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!job || !onDelete) return;

    setIsDeleting(true);
    setGlobalError(null);

    try {
      const result = await onDelete(job.id);

      if (result.error) {
        throw new Error(result.error);
      }

      handleClose();
      window.location.reload();
    } catch (error) {
      setGlobalError(
        error instanceof Error ? error.message : "Failed to delete job"
      );
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleClose = () => {
    if (!submitting && !isDeleting) {
      reset();
      setGlobalError(null);
      setSuccessMessage(null);
      setShowDeleteConfirm(false);
      setSelectedCleaners([]);
      setSelectedJobType("");
      setCurrentStep(1);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      {/* Blurred backdrop */}
      <div
        className="absolute inset-0"
        style={{
          backdropFilter: "blur(2px)",
          backgroundColor: "rgba(175, 175, 175, 0.1)",
        }}
        onClick={handleClose}
      />

      {/* Modal Container */}
      <div className="relative z-[1001] w-full max-w-2xl max-h-[95vh] bg-white rounded-3xl tracking-tight">
        {/* Scrollable Content */}
        <div className="w-full max-h-[95vh] overflow-y-auto overflow-x-visible">
          <div className="w-full px-6 md:px-8 py-6 md:py-8">
            {/* Header */}
            <div className="w-full flex items-start justify-between gap-1 mb-6">
              <div>
                <h1 className="text-2xl font-[350] tracking-tight text-[#005F6A]">
                  {mode === "create" ? "Create New Job" : "Edit Job"}
                </h1>
                <p className="text-sm text-[#005F6A]/60 mt-1">
                  Step {currentStep} of 3 — {STEPS[currentStep - 1].title}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClose}
                disabled={disableForm}
                className="!p-2">
                <X className="w-5 h-5" />
              </Button>
            </div>

            {/* Step Indicator */}
            <div className="flex items-center justify-between mb-8">
              {STEPS.map((step, index) => {
                const StepIcon = step.icon;
                const isActive = currentStep === step.id;
                const isCompleted = currentStep > step.id;

                return (
                  <div key={step.id} className="flex items-center flex-1">
                    <button
                      type="button"
                      onClick={() => goToStep(step.id)}
                      disabled={disableForm}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-all ${
                        isActive
                          ? "bg-[#005F6A] text-white"
                          : isCompleted
                          ? "bg-[#005F6A]/10 text-[#005F6A] hover:bg-[#005F6A]/20"
                          : "bg-[#005F6A]/5 text-[#005F6A]/40"
                      }`}>
                      {isCompleted ? (
                        <Check className="w-4 h-4" />
                      ) : (
                        <StepIcon className="w-4 h-4" />
                      )}
                      <span className="text-xs font-[400] hidden sm:inline">
                        {step.title}
                      </span>
                    </button>
                    {index < STEPS.length - 1 && (
                      <div
                        className={`flex-1 h-[2px] mx-2 rounded-full ${
                          isCompleted ? "bg-[#005F6A]/30" : "bg-[#005F6A]/10"
                        }`}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Success Message */}
            {successMessage && (
              <div className="rounded-2xl p-4 flex items-start gap-3 bg-green-50 border border-green-200 mb-6">
                <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div className="flex flex-col gap-1 flex-1">
                  <p className="text-sm text-green-700 font-[400]">
                    {successMessage}
                  </p>
                </div>
              </div>
            )}

            {/* Delete Confirmation */}
            {mode === "edit" && showDeleteConfirm && (
              <div className="rounded-2xl p-4 flex items-start gap-3 bg-red-50 border border-red-200 mb-6">
                <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="flex flex-col gap-2 flex-1">
                  <p className="text-sm text-red-700 font-[400]">
                    Are you sure you want to delete this job?
                  </p>
                  <p className="text-xs text-red-600/70">
                    This action cannot be undone. All job data will be
                    permanently removed.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Button
                      variant="default"
                      size="sm"
                      border={false}
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={isDeleting}
                      className="px-4 py-2">
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      border={false}
                      onClick={handleDelete}
                      disabled={isDeleting}
                      className="px-4 py-2">
                      {isDeleting ? (
                        <>
                          <Loader className="w-4 h-4 mr-2 animate-spin" />
                          Deleting...
                        </>
                      ) : (
                        <>
                          <Trash2 className="w-4 h-4 mr-2" />
                          Confirm Delete
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit(handleFormSubmit)}>
              {/* Step 1: Basic Information */}
              {currentStep === 1 && (
                <div className="space-y-5">
                  {/* Client Name */}
                  <div>
                    <label className="input-label tracking-tight">
                      Client Name <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#005F6A]/50" />
                      <Input
                        variant="form"
                        type="text"
                        size="md"
                        {...register("clientName")}
                        disabled={disableForm}
                        error={!!errors.clientName}
                        className="w-full pl-11 px-4 py-3 tracking-tight placeholder:tracking-tight"
                        placeholder="e.g., Alexis Juarez"
                        border={false}
                      />
                    </div>
                    {errors.clientName && (
                      <p className="mt-1.5 text-xs text-red-600">
                        {errors.clientName.message}
                      </p>
                    )}
                  </div>

                  {/* Location */}
                  <div>
                    <label className="input-label tracking-tight">
                      Location
                    </label>
                    <div className="relative">
                      <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#005F6A]/50" />
                      <Input
                        variant="form"
                        type="text"
                        size="md"
                        {...register("location")}
                        disabled={disableForm}
                        className="w-full pl-11 px-4 py-3 tracking-tight placeholder:tracking-tight"
                        placeholder="Address or area"
                        border={false}
                      />
                    </div>
                  </div>

                  {/* Job Type */}
                  <div>
                    <label className="input-label tracking-tight">
                      Job Type
                    </label>
                    <CustomDropdown
                      trigger={
                        <Button
                          variant="default"
                          size="md"
                          border={false}
                          type="button"
                          disabled={disableForm}
                          className="w-full h-[44px] px-4 py-3 flex items-center !justify-between bg-[#005F6A]/5">
                          <span className="text-sm font-[350] text-[#005F6A]">
                            {jobTypes.find((t) => t.value === selectedJobType)
                              ?.label || "Select type"}
                          </span>
                          <ChevronDown className="w-4 h-4 text-[#005F6A]/50" />
                        </Button>
                      }
                      options={jobTypes.map((type) => ({
                        label: type.label,
                        onClick: () => setSelectedJobType(type.value),
                      }))}
                      maxHeight="12rem"
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label className="input-label tracking-tight">
                      Description
                    </label>
                    <div className="relative">
                      <Textarea
                        size="md"
                        variant="form"
                        {...register("description")}
                        disabled={disableForm}
                        className="w-full px-4 py-3 tracking-tight placeholder:tracking-tight"
                        placeholder="Brief description of the job..."
                        rows={4}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Schedule & Team */}
              {currentStep === 2 && (
                <div className="space-y-6">
                  {/* Date & Time Section */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-[400] text-[#005F6A] uppercase tracking-tight flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      Schedule
                    </h3>

                    <div className="grid grid-cols-2 gap-4">
                      <Controller
                        name="startDate"
                        control={control}
                        render={({ field }) => (
                          <CustomDatePicker
                            label="Start Date"
                            value={field.value}
                            onChange={field.onChange}
                            disabled={disableForm}
                            placeholder="Select start date"
                          />
                        )}
                      />

                      <Controller
                        name="startTime"
                        control={control}
                        render={({ field }) => (
                          <CustomTimePicker
                            label="Start Time"
                            value={field.value}
                            onChange={field.onChange}
                            disabled={disableForm}
                            placeholder="Select start time"
                          />
                        )}
                      />

                      <Controller
                        name="endDate"
                        control={control}
                        render={({ field }) => (
                          <CustomDatePicker
                            label="End Date"
                            value={field.value}
                            onChange={field.onChange}
                            disabled={disableForm}
                            placeholder="Select end date"
                          />
                        )}
                      />

                      <Controller
                        name="endTime"
                        control={control}
                        render={({ field }) => (
                          <CustomTimePicker
                            label="End Time"
                            value={field.value}
                            onChange={field.onChange}
                            disabled={disableForm}
                            placeholder="Select end time"
                          />
                        )}
                      />
                    </div>
                  </div>

                  {/* Team Section */}
                  <div className="space-y-4">
                    <h3 className="input-label tracking-tight flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Assign Cleaners
                    </h3>

                    {users.length === 0 ? (
                      <div className="bg-[#005F6A]/5 rounded-2xl p-6 text-center">
                        <Users className="w-8 h-8 text-[#005F6A]/30 mx-auto mb-2" />
                        <p className="text-sm text-[#005F6A]/60">
                          No team members available
                        </p>
                      </div>
                    ) : (
                      <SmartSearch
                        items={smartSearchUsers}
                        selectedIds={selectedCleaners}
                        onToggleItem={toggleCleaner}
                        disabled={disableForm}
                        placeholder="Search team members..."
                        selectedLabel="Assigned cleaners:"
                        emptyMessage="No team members found"
                        size="md"
                        filterFn={(item, query) =>
                          item.name
                            .toLowerCase()
                            .includes(query.toLowerCase()) ||
                          (item as { email?: string }).email
                            ?.toLowerCase()
                            .includes(query.toLowerCase()) ||
                          false
                        }
                        renderItem={(item, isSelected) => (
                          <>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-[400] text-[#005F6A]">
                                {item.name}
                              </p>
                              <p className="text-xs text-[#005F6A]/60">
                                {(item as { email?: string }).email}
                              </p>
                            </div>
                            {isSelected && (
                              <Check className="w-4 h-4 text-[#005F6A]" />
                            )}
                          </>
                        )}
                        renderSelectedItem={(item) => (
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-[#005F6A]/20 flex items-center justify-center">
                              <span className="text-xs font-[500] text-[#005F6A]">
                                {item.name.charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <span className="text-sm font-[350] text-[#005F6A]">
                              {item.name}
                            </span>
                          </div>
                        )}
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Step 3: Pricing & Notes */}
              {currentStep === 3 && (
                <div className="space-y-6">
                  {/* Pricing Section */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-[400] text-[#005F6A] uppercase tracking-tight flex items-center gap-2">
                      <DollarSign className="w-4 h-4" />
                      Pricing & Payment
                    </h3>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="input-label tracking-tight">
                          Price
                        </label>
                        <div className="relative">
                          <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#005F6A]/50" />
                          <Input
                            variant="form"
                            type="number"
                            size="md"
                            step="0.01"
                            min="0"
                            {...register("price")}
                            disabled={disableForm}
                            className="w-full pl-11 px-4 py-3 tracking-tight placeholder:tracking-tight"
                            placeholder="0.00"
                            border={false}
                          />
                        </div>
                      </div>

                      <div>
                        <label className="input-label tracking-tight">
                          Employee Pay
                        </label>
                        <div className="relative">
                          <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#005F6A]/50" />
                          <Input
                            variant="form"
                            type="number"
                            size="md"
                            step="0.01"
                            min="0"
                            {...register("employeePay")}
                            disabled={disableForm}
                            className="w-full pl-11 px-4 py-3 tracking-tight placeholder:tracking-tight"
                            placeholder="0.00"
                            border={false}
                          />
                        </div>
                      </div>

                      <div>
                        <label className="input-label tracking-tight">
                          Total Tip
                        </label>
                        <div className="relative">
                          <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#005F6A]/50" />
                          <Input
                            variant="form"
                            type="number"
                            size="md"
                            step="0.01"
                            min="0"
                            {...register("totalTip")}
                            disabled={disableForm}
                            className="w-full pl-11 px-4 py-3 tracking-tight placeholder:tracking-tight"
                            placeholder="0.00"
                            border={false}
                          />
                        </div>
                      </div>

                      <div>
                        <label className="input-label tracking-tight">
                          Parking
                        </label>
                        <div className="relative">
                          <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#005F6A]/50" />
                          <Input
                            variant="form"
                            type="number"
                            size="md"
                            step="0.01"
                            min="0"
                            {...register("parking")}
                            disabled={disableForm}
                            className="w-full pl-11 px-4 py-3 tracking-tight placeholder:tracking-tight"
                            placeholder="0.00"
                            border={false}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Notes Section */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-[400] text-[#005F6A] uppercase tracking-tight flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      Additional Notes
                    </h3>

                    <Textarea
                      size="md"
                      {...register("notes")}
                      disabled={disableForm}
                      className="w-full px-4 py-3 min-h-[120px] bg-[#005F6A]/5 border-0 focus:ring-1 focus:ring-[#005F6A]/20 rounded-2xl tracking-tight placeholder:tracking-tight"
                      placeholder="Any additional notes or special requirements..."
                      rows={4}
                    />
                  </div>
                </div>
              )}

              {/* Global Error */}
              {globalError && (
                <div className="bg-red-50 rounded-2xl p-3 mt-6">
                  <p className="text-xs text-red-600">{globalError}</p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="w-full flex flex-col md:flex-row justify-between pt-6 items-center border-[#005F6A]/10 gap-4">
                {/* Left side - Delete button (only in edit mode on last step) */}
                {mode === "edit" &&
                currentStep === 3 &&
                !showDeleteConfirm &&
                onDelete ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="md"
                    border={false}
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={disableForm}
                    className="px-4 py-3 w-full md:w-auto">
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete Job
                  </Button>
                ) : (
                  <div />
                )}

                {/* Right side - Navigation buttons */}
                <div className="flex gap-3 w-full md:w-auto">
                  {currentStep > 1 ? (
                    <Button
                      type="button"
                      variant="default"
                      size="md"
                      border={false}
                      onClick={handlePrevStep}
                      disabled={disableForm}
                      className="px-5 py-3 flex-1 md:flex-none">
                      <ChevronLeft className="w-4 h-4 mr-1" />
                      Back
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="default"
                      size="md"
                      border={false}
                      onClick={handleClose}
                      disabled={disableForm}
                      className="px-5 py-3 flex-1 md:flex-none">
                      Cancel
                    </Button>
                  )}

                  {currentStep < 3 ? (
                    <Button
                      type="button"
                      variant="primary"
                      size="md"
                      onClick={handleNextStep}
                      disabled={disableForm}
                      className="px-5 py-3 flex-1 md:flex-none">
                      Next
                      <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="md"
                      type="submit"
                      disabled={disableForm}
                      className="px-6 py-3 flex-1 md:flex-none">
                      {submitting ? (
                        <>
                          <Loader className="w-4 h-4 mr-2 animate-spin" />
                          {mode === "create" ? "Creating..." : "Updating..."}
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4 mr-2" />
                          {mode === "create" ? "Create Job" : "Update Job"}
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
