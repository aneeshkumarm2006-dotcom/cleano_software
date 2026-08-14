"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import { addonIcon } from "@/lib/addon-icons";
import { addOnKey } from "@/lib/checklist-triggers";
import {
  addOnLineTotal,
  ADDON_INCLUDED_LABEL,
  computeJobMoney,
  MAX_ADDON_QUANTITY,
  PRICING_MODE_HINT,
  PRICING_MODE_LABEL,
  resolvePricingMode,
  type JobPricingMode,
} from "@/lib/job-money";
import { DEFAULT_TAX_RATES, type TaxRates } from "@/lib/tax";
import {
  NEW_ADDRESS,
  addressOptionLabel,
  pickDefaultAddress,
  stripDuplicatedApt,
  type SavedAddress,
} from "@/lib/client-address";
import { tzInputParts } from "@/lib/time";
import { isSqftJobType, moveInOutBasePrice } from "@/lib/service-pricing";
import {
  DEFAULT_SERVICE_CATALOG,
  resolveServiceValue,
  serviceOptions as catalogServiceOptions,
} from "@/lib/service-catalog";
import { getJobSeriesInfo } from "../actions/getJobSeriesInfo";
import { checkAvailabilityBatch } from "../actions/checkAvailability";
import type { EmployeeAvailabilityStatus } from "../actions/checkAvailability.types";
import {
  StatusIndicator,
  CategoryIndicator,
  AssignmentWarningPanel,
} from "@/components/admin/AssignmentIndicators";
import { categoryMismatchWarning } from "@/lib/service-permissions";
import { DISCOUNT_REASONS, NO_REASON_LABEL } from "@/lib/discount-reasons";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import CustomDropdown from "@/components/ui/custom-dropdown";
import PremiumSelect from "@/components/ui/PremiumSelect";
import SmartSearch from "@/components/SmartSearch";
import SaveCardOnFile from "./SaveCardOnFile";
import { parseTimeInput } from "@/components/ui/TimePicker";

export interface AddOnCatalogItem {
  id: string;
  name: string;
  price: number;
  /** Admin-chosen icon key (item 17); absent = guessed from the name. */
  icon?: string;
}

/** A row in the modal's chosen-add-on list. `price` is the UNIT price. */
interface ChosenAddOn {
  rowId: string;
  name: string;
  price: number;
  quantity: number;
}

let addOnRowSeq = 0;
const nextAddOnRowId = () => `ao-${++addOnRowSeq}`;

export interface User {
  id: string;
  name: string;
  email: string;
  /**
   * Service categories this cleaner may work; empty = all (awerfixes.pdf item
   * 3). Optional so a mount point that hasn't been plumbed yet degrades to "no
   * restriction" — which is the correct default — instead of crashing.
   */
  allowedServiceCategories?: string[];
}

interface Job {
  id: string;
  clientName: string;
  clientId?: string | null;
  location: string | null;
  aptNumber?: string | null;
  /** Address snapshot, beside location/aptNumber (item 3). */
  postalCode?: string | null;
  /** Which saved address this job was booked against (item 2, provenance). */
  clientAddressId?: string | null;
  description: string | null;
  jobType: string | null;
  jobDate: string | null;
  startTime: string;
  endTime: string | null;
  price: number | null;
  employeePay: number | null;
  /**
   * TRUE when `employeePay` is an authoritative MANUAL TEAM TOTAL rather than a
   * save-time estimate (decision D2). Drives the "Manual" state of the Employee
   * pay field and the "Clear — use automatic calculation" control below.
   */
  employeePayIsManual?: boolean | null;
  payType?: string | null;
  hourlyRate?: number | null;
  totalTip: number | null;
  parking: number | null;
  notes: string | null;
  paymentType?: string | null;
  discountAmount?: number | null;
  bedCount?: number | null;
  bathCount?: number | null;
  halfBathCount?: number | null;
  squareFootage?: number | null;
  /** Per-job sales-tax exemption (item 7). */
  taxExempt?: boolean | null;
  /** Why a discount was applied (item 29). */
  discountReason?: string | null;
  cleaners: Array<{ id: string; name: string }>;
  addOns?: Array<{ id: string; name: string; price: number; quantity?: number }>;
  /** Historical fallback for `pricingMode` — see resolvePricingMode. */
  bookingSource?: string | null;
  /**
   * The stored, admin-chosen pricing mode (fix 2). Decides whether add-ons are
   * ADDED to the price or already inside the job's service total. NULL on jobs
   * written before the column; `resolvePricingMode` covers those.
   */
  pricingMode?: string | null;
  isCashJob?: boolean | null;
  subtotalAmount?: number | null;
}

export interface ClientLite {
  id: string;
  name: string;
  email?: string | null;
  /** Fills the modal's Phone field when this client is linked (item 4). */
  phone?: string | null;
  /** Legacy flat address — the fallback when the client has no address book. */
  address?: string | null;
  aptNumber?: string | null;
  discountPercent?: number | null;
  defaultPaymentMethodId?: string | null;
  /**
   * The client's saved addresses, default first (item 2). Optional so a mount
   * point that hasn't been plumbed yet degrades to the legacy scalar instead of
   * crashing — which is exactly what every mount point did before this stage.
   */
  addresses?: SavedAddress[];
}

interface JobModalProps {
  isOpen: boolean;
  onClose: () => void;
  job?: Job | null;
  mode: "create" | "edit";
  users: User[];
  clients?: ClientLite[];
  onSubmit: (data: FormData) => Promise<{
    success?: boolean;
    error?: string;
    /** Set when the edit was applied across a recurring series (item 9). */
    seriesUpdated?: number;
    seriesSkipped?: number;
  }>;
  onDelete?: (jobId: string) => Promise<{ success?: boolean; error?: string }>;
  /** Add-ons configured in Settings → Pricing Rules; offered as quick-add chips. */
  addOnCatalog?: AddOnCatalogItem[];
  /**
   * Admin-configured GST/QST, for the live total preview. Defaults to the
   * standard rates so a mount point that hasn't been plumbed yet still shows a
   * total rather than crashing.
   */
  taxRates?: TaxRates;
  /** Service list from Settings → Job Types (item 20). */
  serviceOptions?: { value: string; label: string }[];
  /**
   * Move-in/out per-square-foot rates (Settings → Pricing Rules), so the modal
   * can show the live derived price for square-foot services (item 8).
   */
  sqftRates?: {
    thresholdSqft: number;
    rateBelow: number;
    rateAtOrAbove: number;
  } | null;
}

const formSchema = z.object({
  clientName: z.string().min(1, "Client name is required"),
  // Contact details (item 4). Not required — an admin taking a booking over
  // the counter may genuinely have neither — but entering either one is what
  // lets saveJob find or create the customer's contact record, and without a
  // record every receipt, cancellation and rating email silently no-ops.
  // Loose e-mail validation on purpose: a rejected address must not block a
  // booking, and the send path tolerates a bad one.
  clientEmail: z.string().optional(),
  clientPhone: z.string().optional(),
  location: z.string().optional(),
  postalCode: z.string().optional(),
  aptNumber: z.string().optional(),
  description: z.string().optional(),
  jobType: z.string().optional(),
  startDate: z.string().optional(),
  startTime: z.string().optional(),
  price: z.union([z.coerce.number().min(0), z.literal("")]).optional(),
  employeePay: z.union([z.coerce.number().min(0), z.literal("")]).optional(),
  payType: z.enum(["PERCENTAGE", "FLAT", "HOURLY"]).optional(),
  hourlyRate: z.union([z.coerce.number().min(0), z.literal("")]).optional(),
  totalTip: z.union([z.coerce.number().min(0), z.literal("")]).optional(),
  parking: z.union([z.coerce.number().min(0), z.literal("")]).optional(),
  notes: z.string().optional(),
  bedCount: z.union([z.coerce.number().int().min(0), z.literal("")]).optional(),
  bathCount: z.union([z.coerce.number().int().min(0), z.literal("")]).optional(),
  halfBathCount: z.union([z.coerce.number().int().min(0), z.literal("")]).optional(),
  squareFootage: z.union([z.coerce.number().int().min(0), z.literal("")]).optional(),
  discountAmount: z.union([z.coerce.number().min(0), z.literal("")]).optional(),
});

type FormValues = z.infer<typeof formSchema>;

// Job types come from the Settings service catalog (item 20) — no hardcoded
// list here. Values are canonical category keys, so renaming a service in
// Settings never orphans an existing job.

// Recurring-booking frequencies (item 9). Each auto-creates the next few
// occurrences; any configured discount applies from the 2nd cleaning (the first
// is always full price). Discount percentages come from Settings -> Pricing
// Rules per service category, so the hints here stay generic rather than
// hardcoding numbers that can drift from the config.
const frequencies = [
  { value: "ONE_TIME", label: "One-time", hint: "" },
  { value: "DAILY", label: "Daily", hint: "Repeats every day" },
  { value: "WEEKLY", label: "Weekly", hint: "Repeats every week" },
  { value: "BIWEEKLY", label: "Biweekly", hint: "Repeats every 2 weeks" },
  { value: "MONTHLY", label: "Monthly", hint: "Repeats every month" },
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
  const monthLabel = viewDate.toLocaleDateString("en-US", {
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
        className={`w-full px-4 py-3 rounded-2xl border border-[#008C9C]/15 bg-[#008C9C]/5 flex items-center justify-between text-left transition-all tracking-tight ${
          disabled
            ? "opacity-60 cursor-not-allowed"
            : "hover:border-[#008C9C]/40"
        }`}>
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center border border-[#008C9C]/15">
            <Calendar className="w-4 h-4 text-[#008C9C]" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-xs text-[#008C9C]/70">Selected date</span>
            <span
              className={`text-sm font-[450] ${
                value ? "text-[#008C9C]" : "text-[#008C9C]/50"
              }`}>
              {value
                ? new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : placeholder}
            </span>
          </div>
        </div>
        <ChevronDown className="w-4 h-4 text-[#008C9C]/60 flex-shrink-0" />
      </button>

      {isOpen && (
        <div
          className="fixed z-[9999] w-full max-w-sm rounded-2xl bg-white shadow-xl border border-[#008C9C]/10 p-4"
          style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              className="p-2 rounded-lg hover:bg-[#008C9C]/10 text-[#008C9C]"
              onClick={() =>
                setViewDate(
                  new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1)
                )
              }>
              <ChevronLeft className="w-4 h-4" />
            </button>
            <p className="text-sm font-[600] text-[#008C9C] tracking-tight">
              {monthLabel}
            </p>
            <button
              type="button"
              className="p-2 rounded-lg hover:bg-[#008C9C]/10 text-[#008C9C]"
              onClick={() =>
                setViewDate(
                  new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1)
                )
              }>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 text-[11px] text-[#008C9C]/60 mb-2 tracking-tight">
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
                      ? "bg-[#008C9C] text-white shadow-sm"
                      : "hover:bg-[#008C9C]/10 text-[#008C9C]"
                  } ${
                    isToday && !isSelected ? "border border-[#008C9C]/30" : ""
                  }`}>
                  {day}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between mt-3 gap-2">
            <button
              type="button"
              className="flex-1 px-3 py-2 rounded-xl bg-[#008C9C]/10 text-[#008C9C] text-sm font-[500] tracking-tight hover:bg-[#008C9C]/15"
              onClick={handleToday}>
              Today
            </button>
            <button
              type="button"
              className="flex-1 px-3 py-2 rounded-xl bg-white border border-[#008C9C]/20 text-[#008C9C]/80 text-sm font-[500] tracking-tight hover:border-[#008C9C]/40"
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

  // Manual keyboard entry: buffer typed text and parse it on blur/Enter.
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  function commitTyped() {
    const parsed = parseTimeInput(text);
    if (parsed && parsed !== value) onChange(parsed);
  }

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
      <div
        onClick={() => { if (!disabled) inputRef.current?.focus(); }}
        className={`w-full px-4 py-3 rounded-2xl border border-[#008C9C]/15 bg-[#008C9C]/5 flex items-center justify-between text-left transition-all tracking-tight ${
          disabled
            ? "opacity-60 cursor-not-allowed"
            : "hover:border-[#008C9C]/40 cursor-text"
        }`}>
        <div className="flex items-center gap-3 overflow-hidden flex-1">
          <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center border border-[#008C9C]/15 flex-shrink-0">
            <Calendar className="w-4 h-4 text-[#008C9C]" />
          </div>
          <div className="flex flex-col leading-tight flex-1 min-w-0">
            <span className="text-xs text-[#008C9C]/70">Selected time</span>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              disabled={disabled}
              placeholder={placeholder}
              value={editing ? text : value ? formatTimeDisplay(value) : ""}
              onFocus={() => {
                setEditing(true);
                setText(value ? formatTimeDisplay(value) : "");
                setIsOpen(true);
              }}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => { commitTyped(); setEditing(false); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitTyped();
                  setEditing(false);
                  setIsOpen(false);
                  inputRef.current?.blur();
                } else if (e.key === "Escape") {
                  setEditing(false);
                  setIsOpen(false);
                  inputRef.current?.blur();
                }
              }}
              className={`text-sm font-[450] bg-transparent border-0 outline-none p-0 w-full ${
                value ? "text-[#008C9C]" : "text-[#008C9C]/50"
              }`}
            />
          </div>
        </div>
        <ChevronDown className="w-4 h-4 text-[#008C9C]/60 flex-shrink-0" />
      </div>

      {isOpen && (
        <div
          className="fixed z-[9999] w-full max-w-sm rounded-2xl bg-white shadow-xl border border-[#008C9C]/10 max-h-64 overflow-y-auto"
          style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
          <div className="p-2">
            <div className="flex gap-2 mb-2">
              <button
                type="button"
                className="flex-1 px-3 py-2 rounded-xl bg-[#008C9C] text-white text-sm font-[500] tracking-tight hover:bg-[#008C9C]/90"
                onClick={() =>
                  handleTimeSelect(new Date().toTimeString().slice(0, 5))
                }>
                Now
              </button>
              <button
                type="button"
                className="flex-1 px-3 py-2 rounded-xl bg-white border border-[#008C9C]/20 text-[#008C9C]/80 text-sm font-[500] tracking-tight hover:border-[#008C9C]/40"
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
                      ? "bg-[#008C9C] text-white"
                      : "bg-[#008C9C]/5 text-[#008C9C] hover:bg-[#008C9C]/10"
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
  clients = [],
  onSubmit,
  onDelete,
  addOnCatalog = [],
  taxRates = DEFAULT_TAX_RATES,
  serviceOptions = [],
  sqftRates = null,
}: JobModalProps) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedCleaners, setSelectedCleaners] = useState<string[]>([]);
  const [selectedJobType, setSelectedJobType] = useState<string>("");
  const [selectedFrequency, setSelectedFrequency] = useState<string>("ONE_TIME");
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  // Which of the linked client's saved addresses this job uses (item 2).
  // NEW_ADDRESS means "the admin is typing one into Location / Apt below", and
  // saveJob adds it to the client's book on submit.
  const [addressChoice, setAddressChoice] = useState<string>(NEW_ADDRESS);
  const [selectedPaymentType, setSelectedPaymentType] = useState<string>("");
  // Flips to true after admin saves a card via the inline SaveCardOnFile
  // panel. Keeps the success state visible until the modal closes /
  // re-opens (the parent server data still shows defaultPaymentMethodId
  // as null until the page revalidates).
  const [cardSavedNow, setCardSavedNow] = useState(false);
  // `rowId` is a stable client-side key. Keying these rows by array index broke
  // the moment they became editable: delete row 1 and row 2's inputs inherit
  // row 1's DOM state.
  const [addOns, setAddOns] = useState<ChosenAddOn[]>([]);
  const [newAddOnName, setNewAddOnName] = useState("");
  const [newAddOnPrice, setNewAddOnPrice] = useState("");
  const [discountMode, setDiscountMode] = useState<"percent" | "amount">(
    "amount"
  );
  const [discountInput, setDiscountInput] = useState<string>("");
  const [discountTouched, setDiscountTouched] = useState(false);
  // Per-job sales-tax exemption (item 7).
  const [taxExempt, setTaxExempt] = useState(false);
  // How this job is priced (cleano_new_fixes.pdf fix 2). Component state rather
  // than a react-hook-form field because it changes what the Price INPUT MEANS —
  // base service price under ITEMIZED, the whole agreed service total under
  // FINAL_PRICE — so the label, the hint and the live preview all read it.
  const [pricingMode, setPricingMode] = useState<JobPricingMode>("ITEMIZED");
  // Set by the "Recalculate from items" button. Purely so the job log can say
  // the admin pressed the button rather than merely flipped the selector; the
  // money is identical either way. Cleared the moment the mode moves again.
  const [recalcRequested, setRecalcRequested] = useState(false);
  // Is the Employee pay figure an ORDER or a save-time estimate? (D2 / fix 4.)
  //
  // Component state, seeded from the job, for the same reason `pricingMode` is:
  // it changes what the INPUT MEANS. Manual → the number in that box is the
  // crew's total pay for the job, split evenly. Automatic → it is a snapshot the
  // live tier math supersedes.
  //
  // Why the field's own dirty state is not enough: this modal PREFILLS Employee
  // pay from the stored column, so "has a value" is true on every re-save of
  // every job. Typing sets this flag; the Clear control unsets it; and the form
  // posts the answer explicitly so the server never has to guess. See saveJob.ts.
  const [payIsManual, setPayIsManual] = useState(false);
  // Why a discount was given (item 29). The reason field only appears once a
  // discount is actually entered.
  const [discountReason, setDiscountReason] = useState("");
  // Recurring-series edit scope (item 9). Opt-in per save; never sticky.
  const [applyToSeries, setApplyToSeries] = useState(false);
  const [seriesInfo, setSeriesInfo] = useState<{
    isSeries: boolean;
    editableCount: number;
  } | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    trigger,
    control,
    setValue,
    watch,
  } = useForm<FormValues>({
    resolver: (zodResolver as any)(formSchema) as Resolver<FormValues>,
    mode: "onChange",
  });

  // Initialize form when modal opens or job changes
  useEffect(() => {
    if (isOpen) {
      setCurrentStep(1);
      if (job) {
        // Contact details come from the linked customer record, which is where
        // they live — the Job row itself has never carried an email or a phone.
        const jobClient = job.clientId
          ? clients.find((c) => c.id === job.clientId) ?? null
          : null;
        reset({
          clientName: job.clientName || "",
          clientEmail: jobClient?.email || "",
          clientPhone: jobClient?.phone || "",
          location: job.location || "",
          postalCode: job.postalCode || "",
          aptNumber: job.aptNumber || "",
          description: job.description || "",
          jobType: job.jobType || "",
          // Pre-fill the date/time inputs in the BUSINESS timezone. Reading
          // the instant with toISOString() (UTC) showed a 6 PM Toronto job as
          // 10 PM in this modal while the jobs list showed 6 PM.
          startDate: job.startTime ? tzInputParts(job.startTime).date : "",
          startTime: job.startTime ? tzInputParts(job.startTime).time : "",
          price: job.price || "",
          employeePay: job.employeePay || "",
          payType: (job.payType as "PERCENTAGE" | "FLAT" | "HOURLY") || "PERCENTAGE",
          hourlyRate: job.hourlyRate || "",
          totalTip: job.totalTip || "",
          parking: job.parking || "",
          notes: job.notes || "",
          bedCount: job.bedCount ?? "",
          bathCount: job.bathCount ?? "",
          halfBathCount: job.halfBathCount ?? "",
          squareFootage: job.squareFootage ?? "",
          discountAmount: job.discountAmount ?? "",
        });
        setSelectedCleaners(job.cleaners?.map((c) => c.id) || []);
        // Legacy jobs store "R - Residential" / "MOVE_IN" / "STANDARD"; map
        // them onto the currently offered service so editing an old job doesn't
        // silently blank its type (item 20 — "existing jobs mapped where
        // possible"). A MOVE_IN job folds onto a combined Move-in/out service.
        setSelectedJobType(
          resolveServiceValue(
            job.jobType,
            serviceOptions.length > 0
              ? serviceOptions.map((o) => ({
                  id: o.value,
                  name: o.label,
                  category: o.value,
                  isActive: true,
                }))
              : DEFAULT_SERVICE_CATALOG
          )
        );
        // Recurrence is generated only at creation time; editing never
        // re-spawns a series, so always start the picker at one-time.
        setSelectedFrequency("ONE_TIME");
        setSelectedClientId(job.clientId || "");
        // Re-select the saved address this job was booked against, so an edit
        // doesn't silently look like a newly typed one (item 2).
        setAddressChoice(job.clientAddressId || NEW_ADDRESS);
        setSelectedPaymentType(job.paymentType || "");
        setTaxExempt(!!job.taxExempt);
        // The job's stamped mode, or the historical provenance rule for a row
        // written before the column existed — the same answer the server will
        // reach, so the preview and the save agree.
        setPricingMode(
          resolvePricingMode({
            pricingMode: job.pricingMode,
            bookingSource: job.bookingSource,
          })
        );
        setRecalcRequested(false);
        setPayIsManual(!!job.employeePayIsManual);
        setDiscountReason(job.discountReason ?? "");
        setApplyToSeries(false);
        setCardSavedNow(false);
        setAddOns(
          (job.addOns || []).map((a) => ({
            rowId: nextAddOnRowId(),
            name: a.name,
            price: a.price,
            quantity: Math.max(1, a.quantity ?? 1),
          }))
        );
        // Existing job: keep its stored amount as the source of truth
        setDiscountMode("amount");
        setDiscountInput(
          job.discountAmount && job.discountAmount > 0
            ? String(job.discountAmount)
            : ""
        );
        setDiscountTouched(true);
      } else {
        reset({
          clientName: "",
          clientEmail: "",
          clientPhone: "",
          location: "",
          postalCode: "",
          aptNumber: "",
          description: "",
          jobType: "",
          startDate: "",
          startTime: "",
          price: "",
          employeePay: "",
          payType: "PERCENTAGE",
          hourlyRate: "",
          totalTip: "",
          parking: "",
          notes: "",
          bedCount: "",
          bathCount: "",
          halfBathCount: "",
          squareFootage: "",
          discountAmount: "",
        });
        setSelectedCleaners([]);
        setSelectedJobType("");
        setSelectedFrequency("ONE_TIME");
        setSelectedClientId("");
        setAddressChoice(NEW_ADDRESS);
        setSelectedPaymentType("");
        setTaxExempt(false);
        // A brand-new admin job is itemized: its parts ARE its price.
        setPricingMode("ITEMIZED");
        setRecalcRequested(false);
        // A new job's Employee pay box starts empty, so nothing is manual until
        // the admin types into it.
        setPayIsManual(false);
        setDiscountReason("");
        setApplyToSeries(false);
        setSeriesInfo(null);
        setCardSavedNow(false);
        setAddOns([]);
        setDiscountMode("percent");
        setDiscountInput("");
        setDiscountTouched(false);
      }
    }
  }, [isOpen, job, reset]);

  // Auto-prefill discount from selected client's default percent
  useEffect(() => {
    if (!isOpen || discountTouched) return;
    const linked = clients.find((c) => c.id === selectedClientId);
    if (linked && (linked.discountPercent ?? 0) > 0) {
      setDiscountMode("percent");
      setDiscountInput(String(linked.discountPercent));
    } else if (!linked) {
      setDiscountInput("");
    }
  }, [isOpen, selectedClientId, clients, discountTouched]);

  // ── Saved addresses (item 2) ───────────────────────────────────────────────
  // Before this stage the modal ignored the address book entirely: picking a
  // client filled Location from the legacy `Client.address` scalar and never
  // touched Apt at all, so a client with three properties always got whichever
  // one was written last.
  const linkedClient = clients.find((c) => c.id === selectedClientId) ?? null;
  const savedAddresses = linkedClient?.addresses ?? [];

  /**
   * Fill Location / Apt from a saved address.
   *
   * ClientNameField does this by writing `input[name="location"]` through
   * document.querySelector. That works there because the full-page form is
   * uncontrolled — here it would be silently discarded, because react-hook-form
   * owns these fields. Hence setValue.
   */
  const fillAddressFields = (addr: SavedAddress | null) => {
    setValue("location", addr ? stripDuplicatedApt(addr.address, addr.aptNumber) : "", {
      shouldDirty: true,
    });
    setValue("aptNumber", addr?.aptNumber ?? "", { shouldDirty: true });
    setValue("postalCode", addr?.postalCode ?? "", { shouldDirty: true });
  };

  // Registered once so the Client Name input can run its own onChange (detach
  // from the linked customer) after react-hook-form's.
  const clientNameField = register("clientName");

  const onAddressChoice = (v: string) => {
    setAddressChoice(v);
    // "+ Type a new address" clears both fields so the admin types into empty
    // inputs; saveJob adds whatever they type to the client's book on submit.
    fillAddressFields(v === NEW_ADDRESS ? null : savedAddresses.find((a) => a.id === v) ?? null);
  };

  // Load recurring-series membership so the "apply to series" control only
  // appears for a job that actually has siblings, with a real count (item 9).
  useEffect(() => {
    if (!isOpen || mode !== "edit" || !job?.id) {
      setSeriesInfo(null);
      return;
    }
    let cancelled = false;
    getJobSeriesInfo(job.id).then((res) => {
      if (cancelled) return;
      setSeriesInfo(
        res.success
          ? { isSeries: res.isSeries, editableCount: res.editableCount }
          : null
      );
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, mode, job?.id]);

  // The Settings catalog plus a blank "Select type" row. Falls back to the
  // shipped defaults if a page hasn't passed the catalog through yet.
  const serviceChoices = [
    { value: "", label: "Select type" },
    ...(serviceOptions.length > 0
      ? serviceOptions
      : catalogServiceOptions(DEFAULT_SERVICE_CATALOG)),
  ];

  const discountIsSet = (parseFloat(discountInput) || 0) > 0;

  const disableForm = submitting || isDeleting;

  // ── Add-ons & custom extra charges (awerfixes item 10) ───────────────────
  const updateAddOn = (rowId: string, patch: Partial<ChosenAddOn>) =>
    setAddOns((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r))
    );

  // "custom" is derived from the catalog rather than stored on the row, so it
  // needs no column. A renamed catalog entry re-labels historical rows — the
  // accepted cost.
  const catalogAddOnKeys = useMemo(
    () => new Set(addOnCatalog.map((c) => addOnKey(c.name))),
    [addOnCatalog]
  );

  // The Add button used to gate on the NAME only, so a blank price silently
  // became $0 — a charge the admin thought they had entered and that billed
  // nothing.
  const newAddOnPriceNum = parseFloat(newAddOnPrice);
  const newAddOnValid =
    !!newAddOnName.trim() &&
    Number.isFinite(newAddOnPriceNum) &&
    newAddOnPriceNum >= 0;

  const addCustomCharge = () => {
    if (!newAddOnValid) return;
    setAddOns((prev) => [
      ...prev,
      {
        rowId: nextAddOnRowId(),
        name: newAddOnName.trim(),
        price: newAddOnPriceNum,
        quantity: 1,
      },
    ]);
    setNewAddOnName("");
    setNewAddOnPrice("");
  };

  // Enter must not submit the whole job — this block lives inside the form.
  const handleNewAddOnKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    addCustomCharge();
  };

  // Square-footage pricing feedback (item 8). `selectedJobType` is the admin
  // vocabulary ("MOVE_IN - Move-in Cleaning"); isSqftJobType folds both halves
  // of a move, matching what saveJob does on the server.
  const sqftPriced = isSqftJobType(selectedJobType);
  const watchedSqft = Number(watch("squareFootage")) || 0;
  const watchedPrice = Number(watch("price")) || 0;

  // Live total preview. Mirrors exactly what saveJob will write: the same mode
  // resolution, the same "a retyped price re-authors the override" rule, and the
  // same helper doing the arithmetic. If these two ever disagree the admin is
  // shown one number and the customer is charged another.
  const previewDiscount = (() => {
    const n = parseFloat(discountInput);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return discountMode === "percent"
      ? Math.round(watchedPrice * (n / 100) * 100) / 100
      : n;
  })();
  const previewPriceRetyped =
    job?.price != null && Math.abs(job.price - watchedPrice) >= 0.005;
  const previewOverrideSubtotal =
    pricingMode === "FINAL_PRICE"
      ? previewPriceRetyped || !job?.subtotalAmount || job.subtotalAmount <= 0
        ? watchedPrice
        : job.subtotalAmount
      : null;
  const previewMoney = computeJobMoney(
    {
      pricingMode,
      bookingSource: job?.bookingSource,
      subtotalAmount: previewOverrideSubtotal,
      price: watchedPrice,
      discountAmount: previewDiscount,
      isCashJob: job?.isCashJob,
      taxExempt,
      addOns,
    },
    taxRates
  );
  // The counterfactual: what the parts come to. Under FINAL_PRICE this is the
  // "Calculated from items" figure shown beside the active override, and the
  // number the Recalculate button would adopt. Under ITEMIZED the two are equal
  // by construction, so nothing extra is drawn.
  const previewItemizedTotal = previewMoney.itemizedSubtotal;
  const previewTotalsDiffer =
    pricingMode === "FINAL_PRICE" &&
    Math.abs(previewItemizedTotal - previewMoney.subtotalAmount) >= 0.01;

  const changePricingMode = (next: JobPricingMode, viaRecalculate = false) => {
    setPricingMode(next);
    setRecalcRequested(viaRecalculate);
  };
  const sqftDerivedPrice =
    sqftPriced && sqftRates && watchedSqft > 0
      ? moveInOutBasePrice(watchedSqft, {
          // Only the move-in/out block is used by this helper; the rest of the
          // config is irrelevant here.
          moveInOut: sqftRates,
        } as Parameters<typeof moveInOutBasePrice>[1])
      : null;

  // ── Availability + service-category advisories (awerfixes.pdf items 19 & 3) ──
  //
  // The Jobs list and the Calendar both book through this modal, and it had no
  // availability code at all — the warnings only existed on /admin/jobs/new. The
  // evaluation itself is the same shared server helper (recurring weekly rules
  // PLUS one-off blocked dates), so the two surfaces cannot disagree.
  //
  // Unlike CleanerSelector this does NOT poll the DOM. That form's pickers write
  // into hidden inputs that emit no events, which is why it polls; these are
  // react-hook-form Controllers, so watching the field values is both correct
  // and cheaper. The generation counter is kept — it discards the response to a
  // date the admin has already changed.
  const watchedStartDate = watch("startDate");
  const watchedStartTime = watch("startTime");
  const [statuses, setStatuses] = useState<
    Map<string, EmployeeAvailabilityStatus>
  >(() => new Map());
  // Three states, not two. "No warnings" and "we have not been told yet" look
  // identical on screen unless the in-flight case says so out loud, and this
  // check is slow enough that the difference matters: the panel renders nothing
  // until the answer lands, so silence read as "everyone is free" when it
  // actually meant "still asking". `checked` is what makes 17.b's no-coverage
  // line safe to draw — it must never fire off an empty starting Map.
  const [availabilityState, setAvailabilityState] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const availabilityRun = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    const ids = users.map((u) => u.id);
    if (!watchedStartDate || !watchedStartTime || ids.length === 0) {
      availabilityRun.current++;
      setStatuses(new Map());
      setAvailabilityState("idle");
      return;
    }

    const run = ++availabilityRun.current;
    // Debounced: typing through a date shouldn't fire a request per keystroke.
    const timer = setTimeout(() => {
      setAvailabilityState("loading");
      checkAvailabilityBatch({
        employeeIds: ids,
        startDate: watchedStartDate,
        startTime: watchedStartTime,
        // This modal collects no end date/time; the evaluator treats that as a
        // zero-length window that still has to touch an available slot.
        endDate: null,
        endTime: null,
      }).then(
        (res) => {
          if (run !== availabilityRun.current) return;
          setStatuses(
            res.success
              ? new Map(res.statuses.map((s) => [s.employeeId, s]))
              : new Map()
          );
          setAvailabilityState(res.success ? "loaded" : "error");
        },
        // There was no rejection handler here at all. `checkAvailabilityBatch`
        // catches its own errors, but the CALL can still reject — a dropped
        // connection, a stale deployment's "Failed to find Server Action" —
        // and every one of those failed silently, leaving the panel blank and
        // indistinguishable from "no conflicts".
        () => {
          if (run !== availabilityRun.current) return;
          setStatuses(new Map());
          setAvailabilityState("error");
        }
      );
    }, 300);

    return () => clearTimeout(timer);
  }, [isOpen, users, watchedStartDate, watchedStartTime]);

  /** Category mismatch for one cleaner against the chosen job type, or null. */
  const categoryWarnFor = useCallback(
    (u: User) =>
      categoryMismatchWarning(
        u.name,
        selectedJobType,
        u.allowedServiceCategories
      ),
    [selectedJobType]
  );

  const selectedUsers = useMemo(
    () => users.filter((u) => selectedCleaners.includes(u.id)),
    [users, selectedCleaners]
  );

  const availabilityAdvisories = useMemo(
    () =>
      selectedUsers
        .map((u) => ({ user: u, status: statuses.get(u.id) }))
        .filter(
          (x): x is { user: User; status: EmployeeAvailabilityStatus } =>
            !!x.status &&
            x.status.result !== "AVAILABLE" &&
            x.status.result !== "NO_DATA"
        )
        .map(({ user, status }) => ({
          cleanerId: user.id,
          cleanerName: user.name,
          detail:
            status.reason ??
            (status.result === "UNAVAILABLE"
              ? "marked unavailable"
              : "outside their availability"),
        })),
    [selectedUsers, statuses]
  );

  const categoryAdvisories = useMemo(
    () =>
      selectedUsers
        .map((u) => ({ user: u, warning: categoryWarnFor(u) }))
        .filter((x): x is { user: User; warning: string } => !!x.warning)
        .map(({ user, warning }) => ({
          cleanerId: user.id,
          cleanerName: user.name,
          detail: warning,
        })),
    [selectedUsers, categoryWarnFor]
  );

  // 17.b — every candidate is unavailable for this slot. NO_DATA cleaners are
  // not counted as unavailable: they simply never filled the form in, and
  // treating silence as "can't work" would cry wolf on a fresh install.
  const noCoverage = useMemo(() => {
    // Only ever claimed on a COMPLETE answer. Gating on `statuses.size` alone
    // was nearly right but not quite: an errored lookup also clears the Map,
    // and "we couldn't ask" must not be reported as "nobody is free".
    if (availabilityState !== "loaded") return false;
    if (statuses.size === 0 || users.length === 0) return false;
    return users.every((u) => {
      const s = statuses.get(u.id);
      return s?.result === "UNAVAILABLE" || s?.result === "OUTSIDE_HOURS";
    });
  }, [users, statuses, availabilityState]);

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
  // allowedServiceCategories rides along so the row renderers can compute the
  // category advisory without a second lookup back into `users`.
  const smartSearchUsers = users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    allowedServiceCategories: user.allowedServiceCategories,
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
      formData.append("clientId", selectedClientId);
      // Item 4. With no linked client these are what saveJob dedupes on and
      // then creates the customer record from — a job saved without them keeps
      // the old behaviour (free-text name, no contact, no emails).
      formData.append("clientEmail", values.clientEmail || "");
      formData.append("clientPhone", values.clientPhone || "");
      formData.append("location", values.location || "");
      formData.append("postalCode", values.postalCode || "");
      formData.append("aptNumber", values.aptNumber || "");
      // Which saved address was picked (item 2). NEW_ADDRESS is sent as empty
      // — saveJob then adds the typed address to the client's book and links
      // the job to the row it created.
      formData.append(
        "clientAddressId",
        addressChoice === NEW_ADDRESS ? "" : addressChoice
      );
      formData.append("description", values.description || "");
      formData.append("jobType", selectedJobType);
      formData.append("frequency", selectedFrequency);
      formData.append("startDate", values.startDate || "");
      formData.append("startTime", values.startTime || "");
      formData.append("price", String(values.price || ""));
      formData.append("employeePay", String(values.employeePay || ""));
      // D2 — say explicitly whether that number is an order or an estimate. An
      // empty box can never be a manual team total, so it always posts "off".
      formData.append(
        "employeePayIsManual",
        payIsManual && String(values.employeePay || "") !== "" ? "on" : "off"
      );
      formData.append("payType", values.payType || "PERCENTAGE");
      formData.append("hourlyRate", String(values.hourlyRate || ""));
      formData.append("totalTip", String(values.totalTip || ""));
      formData.append("parking", String(values.parking || ""));
      formData.append("notes", values.notes || "");
      formData.append("bedCount", String(values.bedCount || ""));
      formData.append("bathCount", String(values.bathCount || ""));
      formData.append("halfBathCount", String(values.halfBathCount || ""));
      formData.append("squareFootage", String(values.squareFootage || ""));

      // Resolve discount: convert percent to amount if needed.
      // If admin has touched the field, send an explicit value (including "0")
      // so server-side auto-apply doesn't override their choice.
      const discountValueNum = parseFloat(discountInput);
      let resolvedDiscount = "";
      if (Number.isFinite(discountValueNum) && discountValueNum > 0) {
        if (discountMode === "percent") {
          const priceNum = Number(values.price) || 0;
          resolvedDiscount =
            priceNum > 0
              ? (priceNum * (discountValueNum / 100)).toFixed(2)
              : "0";
        } else {
          resolvedDiscount = String(discountValueNum);
        }
      } else if (discountTouched) {
        resolvedDiscount = "0";
      }
      formData.append("discountAmount", resolvedDiscount);
      formData.append(
        "discountReason",
        discountReason === "Other" ? "" : discountReason
      );
      if (taxExempt) formData.append("taxExempt", "on");
      // The mode is posted on every save, so it can never be re-inferred from
      // whether the price field still matches what was stored (fix 2).
      formData.append("pricingMode", pricingMode);
      if (recalcRequested) formData.append("recalculateFromItems", "on");
      if (applyToSeries) formData.append("applyToSeries", "on");
      formData.append("paymentType", selectedPaymentType);
      formData.append("addOns", JSON.stringify(addOns));

      // Add cleaners. The marker tells saveJob this submission owns the team
      // picker, so an empty selection means "the admin cleared the team"
      // rather than "this form doesn't manage cleaners" — without it, saveJob
      // leaves the existing assignment alone (new fix list item 2).
      formData.append("cleanersSubmitted", "1");
      selectedCleaners.forEach((id) => {
        formData.append("cleaners", id);
      });

      const result = await onSubmit(formData);

      if (result.error) {
        throw new Error(result.error);
      }

      const updated = result.seriesUpdated ?? 0;
      const skipped = result.seriesSkipped ?? 0;
      setSuccessMessage(
        mode === "create"
          ? "Job created successfully"
          : updated > 0
          ? `Job updated — ${updated} other occurrence${updated === 1 ? "" : "s"} in the series also updated` +
            (skipped > 0
              ? `, ${skipped} left untouched (completed or paid)`
              : "")
          : "Job updated successfully"
      );

      setTimeout(() => {
        handleClose();
        // router.refresh() re-fetches the jobs data but PRESERVES the client
        // component state — the active status tab, search, date range, and the
        // type/client/employee/pay filters — so saving a booking returns the
        // admin to the exact same filtered view. window.location.reload()
        // wiped all of that.
        router.refresh();
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
      // Preserve the current filtered view on delete too.
      router.refresh();
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
      setSelectedFrequency("ONE_TIME");
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
                <h1 className="text-2xl font-[350] tracking-tight text-[#008C9C]">
                  {mode === "create" ? "Create New Job" : "Edit Job"}
                </h1>
                <p className="text-sm text-[#008C9C]/60 mt-1">
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
                          ? "bg-[#008C9C] text-white"
                          : isCompleted
                          ? "bg-[#008C9C]/10 text-[#008C9C] hover:bg-[#008C9C]/20"
                          : "bg-[#008C9C]/5 text-[#008C9C]/40"
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
                          isCompleted ? "bg-[#008C9C]/30" : "bg-[#008C9C]/10"
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
                    Archive this job?
                  </p>
                  <p className="text-xs text-red-600/70">
                    It moves to Jobs &rarr; Archived and drops out of every list,
                    count and report. You can restore it from there, or delete it
                    permanently once archived.
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
                  {/* Existing Client Picker (searchable) */}
                  {clients.length > 0 && (
                    <ClientSearchPicker
                      clients={clients}
                      selectedClientId={selectedClientId}
                      disabled={disableForm}
                      onSelect={(c) => {
                        setSelectedClientId(c.id);
                        setDiscountTouched(false);
                        setValue("clientName", c.name, {
                          shouldValidate: true,
                          shouldDirty: true,
                        });
                        // Prefer the client's default saved address; fall back
                        // to the legacy flat scalar for a client whose book is
                        // still empty (item 2 — same rule as ClientNameField).
                        // Contact details follow the customer (item 4) — the
                        // same thing ClientNameField.pick() does on the
                        // full-page form.
                        setValue("clientEmail", c.email || "", {
                          shouldDirty: true,
                        });
                        setValue("clientPhone", c.phone || "", {
                          shouldDirty: true,
                        });
                        const def = pickDefaultAddress(c.addresses);
                        if (def) {
                          setAddressChoice(def.id);
                          setValue(
                            "location",
                            stripDuplicatedApt(def.address, def.aptNumber),
                            { shouldDirty: true }
                          );
                          setValue("aptNumber", def.aptNumber ?? "", {
                            shouldDirty: true,
                          });
                          setValue("postalCode", def.postalCode ?? "", {
                            shouldDirty: true,
                          });
                        } else {
                          setAddressChoice(NEW_ADDRESS);
                          setValue("location", c.address || "", {
                            shouldDirty: true,
                          });
                          // Was never set before this stage, so picking a
                          // client left a stale apt from the previous one.
                          setValue("aptNumber", c.aptNumber || "", {
                            shouldDirty: true,
                          });
                          setValue("postalCode", "", { shouldDirty: true });
                        }
                      }}
                      onClear={() => {
                        setSelectedClientId("");
                        setAddressChoice(NEW_ADDRESS);
                        setDiscountTouched(false);
                      }}
                    />
                  )}

                  {/* Client Name.
                      Order (item 4, decision D8): name → email → phone → job
                      type → location. He asked for email and phone as "the
                      first two things"; taken literally that puts them above
                      the name, which breaks the typeahead — the name search is
                      what FILLS them. Same order as the full-page form. */}
                  <div>
                    <label className="input-label tracking-tight">
                      Client Name <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#008C9C]/50" />
                      <Input
                        variant="form"
                        type="text"
                        size="md"
                        {...clientNameField}
                        onChange={(e) => {
                          clientNameField.onChange(e);
                          // Editing the name detaches from the saved customer,
                          // so saveJob dedupes/creates from what's typed rather
                          // than silently booking the previously picked client
                          // under a different name (mirrors ClientNameField).
                          if (selectedClientId) {
                            setSelectedClientId("");
                            setAddressChoice(NEW_ADDRESS);
                            setDiscountTouched(false);
                          }
                        }}
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

                  {/* Email + Phone (item 4) — filled from the linked customer,
                      editable, and used to find-or-create the contact record
                      for a brand-new one. Two-up, stacking below 640px, same
                      as `.cnf-contact-grid` on the full-page form. */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="input-label tracking-tight">
                        Email
                      </label>
                      <Input
                        variant="form"
                        type="email"
                        size="md"
                        autoComplete="off"
                        {...register("clientEmail")}
                        disabled={disableForm}
                        className="w-full px-4 py-3 tracking-tight placeholder:tracking-tight"
                        placeholder="name@example.com"
                        border={false}
                      />
                    </div>
                    <div>
                      <label className="input-label tracking-tight">
                        Phone
                      </label>
                      <Input
                        variant="form"
                        type="tel"
                        size="md"
                        autoComplete="off"
                        {...register("clientPhone")}
                        disabled={disableForm}
                        className="w-full px-4 py-3 tracking-tight placeholder:tracking-tight"
                        placeholder="(514) 555-0199"
                        border={false}
                      />
                    </div>
                  </div>
                  {!selectedClientId && (
                    <p className="-mt-2 text-xs text-[#008C9C]/70">
                      No customer linked — an email or phone finds the existing
                      contact, or creates one, so this booking can receive
                      receipts and reminders.
                    </p>
                  )}

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
                          className="w-full h-[44px] px-4 py-3 flex items-center !justify-between bg-[#008C9C]/5">
                          <span className="text-sm font-[350] text-[#008C9C]">
                            {serviceChoices.find((t) => t.value === selectedJobType)
                              ?.label || "Select type"}
                          </span>
                          <ChevronDown className="w-4 h-4 text-[#008C9C]/50" />
                        </Button>
                      }
                      options={serviceChoices.map((type) => ({
                        label: type.label,
                        onClick: () => setSelectedJobType(type.value),
                      }))}
                      maxHeight="12rem"
                    />
                  </div>

                  {/* Saved-address picker — only when the linked client has a
                      book. Ported from ClientNameField: default first (the
                      queries order isDefault desc), "+ Type a new address"
                      last. */}
                  {linkedClient && savedAddresses.length > 0 && (
                    <div>
                      <label className="input-label tracking-tight">
                        Address on file
                      </label>
                      <PremiumSelect
                        value={addressChoice}
                        onChange={onAddressChoice}
                        disabled={disableForm}
                        size="md"
                        options={[
                          ...savedAddresses.map((a) => ({
                            value: a.id,
                            label: addressOptionLabel(a),
                          })),
                          { value: NEW_ADDRESS, label: "+ Type a new address" },
                        ]}
                      />
                      <p className="mt-1.5 text-xs text-[#008C9C]/70">
                        Pick a saved address, or choose “Type a new address” and
                        fill Location below — it’s added to this client’s
                        address book when you save.
                      </p>
                    </div>
                  )}

                  {/* Location */}
                  <div>
                    <label className="input-label tracking-tight">
                      Location
                    </label>
                    <div className="relative">
                      <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#008C9C]/50" />
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

                  {/* Postal code + Apartment (item 3). The postal code is
                      saved on the job and pushed onto the client's saved
                      address. */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="input-label tracking-tight">
                        Postal code
                      </label>
                      <Input
                        variant="form"
                        type="text"
                        size="md"
                        {...register("postalCode")}
                        disabled={disableForm}
                        className="w-full px-4 py-3 tracking-tight placeholder:tracking-tight"
                        placeholder="H2X 1Y6"
                        border={false}
                      />
                    </div>
                    <div>
                      <label className="input-label tracking-tight">
                        Apartment / Unit #
                      </label>
                      <Input
                        variant="form"
                        type="text"
                        size="md"
                        {...register("aptNumber")}
                        disabled={disableForm}
                        className="w-full px-4 py-3 tracking-tight placeholder:tracking-tight"
                        placeholder="e.g. Apt 4B"
                        border={false}
                      />
                    </div>
                  </div>

                  {/* Item 3 / stage 4.4 — the `parking` column, relabelled and
                      moved here from step 3 "Pricing & Notes". It belongs NEAR
                      THE ADDRESS: it is priced off how far the crew travels,
                      and the address is on this step. Nothing changed under the
                      surface — same `register("parking")`, same value appended
                      to the form data, still what the analytics Transportation
                      tile sums (getLabourCostMetric). Manual entry, no zone
                      table. */}
                  <div>
                    <label className="input-label tracking-tight">
                      Transportation
                    </label>
                    <div className="relative">
                      <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#008C9C]/50" />
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
                    <h3 className="text-sm font-[400] text-[#008C9C] uppercase tracking-tight flex items-center gap-2">
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
                    </div>

                    {/* Frequency — recurring bookings (creation only) */}
                    {mode === "create" && (
                      <div>
                        <label className="input-label tracking-tight">
                          Frequency
                        </label>
                        <CustomDropdown
                          trigger={
                            <Button
                              variant="default"
                              size="md"
                              border={false}
                              type="button"
                              disabled={disableForm}
                              className="w-full h-[44px] px-4 py-3 flex items-center !justify-between bg-[#008C9C]/5">
                              <span className="text-sm font-[350] text-[#008C9C]">
                                {frequencies.find(
                                  (f) => f.value === selectedFrequency
                                )?.label || "One-time"}
                              </span>
                              <ChevronDown className="w-4 h-4 text-[#008C9C]/50" />
                            </Button>
                          }
                          options={frequencies.map((f) => ({
                            label: f.label,
                            onClick: () => setSelectedFrequency(f.value),
                          }))}
                          maxHeight="12rem"
                        />
                        {(() => {
                          const hint = frequencies.find(
                            (f) => f.value === selectedFrequency
                          )?.hint;
                          return hint ? (
                            <p className="mt-2 text-xs text-[#008C9C]/60 tracking-tight">
                              {hint}. The first cleaning is full price; future
                              cleanings are auto-created and get any recurring
                              discount configured for this service.
                            </p>
                          ) : null;
                        })()}
                      </div>
                    )}

                    {/* Item 9: editing ONE occurrence must not change the rest,
                        so this is opt-in and only shown for a real series. */}
                    {mode === "edit" && seriesInfo?.isSeries && (
                      <div
                        className={`rounded-xl px-3 py-2.5 border ${
                          applyToSeries
                            ? "bg-amber-50 border-amber-200"
                            : "bg-[#008C9C]/5 border-transparent"
                        }`}>
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={applyToSeries}
                            onChange={(e) => setApplyToSeries(e.target.checked)}
                            disabled={disableForm}
                            className="mt-0.5"
                          />
                          <span className="text-xs">
                            <span className="font-[500] text-[#008C9C]">
                              Apply changes to the whole recurring series
                            </span>
                            <span className="block text-[#008C9C]/60 mt-0.5">
                              {applyToSeries
                                ? `Updates this and ${seriesInfo.editableCount} other occurrence${
                                    seriesInfo.editableCount === 1 ? "" : "s"
                                  }. Each keeps its own date and time; completed, paid and cancelled visits are left untouched.`
                                : `Only this occurrence changes. ${seriesInfo.editableCount} other visit${
                                    seriesInfo.editableCount === 1 ? "" : "s"
                                  } in the series stay as they are.`}
                            </span>
                          </span>
                        </label>
                      </div>
                    )}
                  </div>

                  {/* Team Section */}
                  <div className="space-y-4">
                    <h3 className="input-label tracking-tight flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Assign Cleaners
                    </h3>

                    {users.length === 0 ? (
                      <div className="bg-[#008C9C]/5 rounded-2xl p-6 text-center">
                        <Users className="w-8 h-8 text-[#008C9C]/30 mx-auto mb-2" />
                        <p className="text-sm text-[#008C9C]/60">
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
                              <p className="text-sm font-[400] text-[#008C9C]">
                                {item.name}
                              </p>
                              <p className="text-xs text-[#008C9C]/60">
                                {(item as { email?: string }).email}
                              </p>
                            </div>
                            {/* Advisory indicators — never a disabled row. */}
                            <CategoryIndicator
                              warning={categoryWarnFor(item as User)}
                            />
                            <StatusIndicator status={statuses.get(item.id)} />
                            {isSelected && (
                              <Check className="w-4 h-4 text-[#008C9C]" />
                            )}
                          </>
                        )}
                        renderSelectedItem={(item) => (
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-[#008C9C]/20 flex items-center justify-center">
                              <span className="text-xs font-[500] text-[#008C9C]">
                                {item.name.charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <CategoryIndicator
                              warning={categoryWarnFor(item as User)}
                            />
                            <StatusIndicator status={statuses.get(item.id)} />
                            <span className="text-sm font-[350] text-[#008C9C]">
                              {item.name}
                            </span>
                          </div>
                        )}
                      />
                    )}

                    {/* Availability + service-category advisories (items 19 &
                        3). Nothing here blocks the save — the admin can always
                        override, which the panel's closing line says out loud. */}
                    <AssignmentWarningPanel
                      availability={availabilityAdvisories}
                      categories={categoryAdvisories}
                      noCoverage={noCoverage}
                      // Only speak up once there is somebody the answer could
                      // be about. The lookup starts as soon as a date and time
                      // exist, so without this the panel would announce
                      // "checking availability…" before any cleaner is picked.
                      availabilityState={
                        selectedUsers.length > 0 ? availabilityState : "idle"
                      }
                    />
                  </div>
                </div>
              )}

              {/* Step 3: Pricing & Notes */}
              {currentStep === 3 && (
                <div className="space-y-6">
                  {/* Pricing Section */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-[400] text-[#008C9C] uppercase tracking-tight flex items-center gap-2">
                      <DollarSign className="w-4 h-4" />
                      Pricing & Payment
                    </h3>

                    {/* How this job is priced (cleano_new_fixes.pdf fix 2).
                        The mode used to be invisible and inferred from where
                        the booking came from, so an admin retyping the price of
                        an imported job silently flipped it and its add-ons
                        started adding to a total that already contained them.
                        It is a choice now, and it is stored. */}
                    <div className="space-y-2">
                      <label className="input-label tracking-tight">
                        Pricing mode
                      </label>
                      <div
                        role="radiogroup"
                        aria-label="Pricing mode"
                        className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {(["ITEMIZED", "FINAL_PRICE"] as const).map((m) => {
                          const active = pricingMode === m;
                          return (
                            <button
                              key={m}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              disabled={disableForm}
                              onClick={() => changePricingMode(m)}
                              className={`text-left px-4 py-3 rounded-xl transition-colors ${
                                active
                                  ? "bg-[#008C9C]/15 ring-1 ring-[#008C9C]/40"
                                  : "bg-[#008C9C]/5 hover:bg-[#008C9C]/10"
                              } disabled:opacity-60`}>
                              <span className="block text-sm font-[600] text-[#008C9C] tracking-tight">
                                {PRICING_MODE_LABEL[m]}
                              </span>
                              <span className="block text-xs text-[#008C9C]/60 tracking-tight mt-0.5">
                                {PRICING_MODE_HINT[m]}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="input-label tracking-tight">
                          {pricingMode === "FINAL_PRICE"
                            ? "Service total (override)"
                            : "Price"}
                        </label>
                        <div className="relative">
                          <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#008C9C]/50" />
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

                      {/* Employee pay, and whether it is an ORDER or an estimate
                          (cleano_new_fixes.pdf fix 4, decision D2).

                          Typing here means "pay the crew this" — a team total
                          split evenly — and it holds until an admin clears it.
                          That is the PDF's "manual cleaner pay overrides the
                          automatic calculation until admin clears it", and the
                          reason the job page no longer prints a stored figure
                          as "not used". */}
                      <div>
                        <label className="input-label tracking-tight">
                          Employee Pay
                        </label>
                        <div className="relative">
                          <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#008C9C]/50" />
                          <Input
                            variant="form"
                            type="number"
                            size="md"
                            step="0.01"
                            min="0"
                            {...register("employeePay", {
                              // Editing the box IS the act of taking the override.
                              // Registered through RHF's own onChange so the
                              // field stays fully controlled by the resolver.
                              onChange: () => setPayIsManual(true),
                            })}
                            disabled={disableForm}
                            className="w-full pl-11 px-4 py-3 tracking-tight placeholder:tracking-tight"
                            placeholder="0.00"
                            border={false}
                          />
                        </div>
                        {payIsManual && String(watch("employeePay") || "") !== "" ? (
                          <div className="mt-1.5 flex items-center justify-between gap-2">
                            <span className="text-[11px] font-[600] tracking-tight text-[#92400e] bg-[#fffbeb] rounded-full px-2 py-0.5">
                              Manual — team total, split evenly
                            </span>
                            <button
                              type="button"
                              disabled={disableForm}
                              onClick={() => {
                                setPayIsManual(false);
                                setValue("employeePay", "", {
                                  shouldDirty: true,
                                });
                              }}
                              className="text-[11px] tracking-tight text-[#008C9C] underline underline-offset-2 disabled:opacity-60">
                              Clear — use automatic calculation
                            </button>
                          </div>
                        ) : (
                          <p className="mt-1.5 text-[11px] tracking-tight text-[#008C9C]/60">
                            Leave blank for the automatic tier calculation on the
                            job&apos;s active value (base + add-ons).
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="input-label tracking-tight">
                          Pay type
                        </label>
                        <select
                          {...register("payType")}
                          disabled={disableForm}
                          className="w-full px-4 py-3 rounded-xl bg-[#008C9C]/5 text-sm tracking-tight outline-none focus:bg-white"
                        >
                          <option value="PERCENTAGE">Percentage (tier split)</option>
                          <option value="FLAT">Flat rate</option>
                          <option value="HOURLY">Hourly</option>
                        </select>
                      </div>

                      {watch("payType") === "HOURLY" && (
                        <div>
                          <label className="input-label tracking-tight">
                            Hourly Rate
                          </label>
                          <div className="relative">
                            <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#008C9C]/50" />
                            <Input
                              variant="form"
                              type="number"
                              size="md"
                              step="0.01"
                              min="0"
                              {...register("hourlyRate")}
                              disabled={disableForm}
                              className="w-full pl-11 px-4 py-3 tracking-tight placeholder:tracking-tight"
                              placeholder="0.00"
                              border={false}
                            />
                          </div>
                        </div>
                      )}

                      <div>
                        <label className="input-label tracking-tight">
                          Total Tip
                        </label>
                        <div className="relative">
                          <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#008C9C]/50" />
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

                      {/* Transportation used to sit here, between Total Tip and
                          Discount. It moved to step 1 "Basic Info", directly
                          under Postal code (stage 4.4 — near the address). */}

                      <div>
                        <div className="flex items-center justify-between">
                          <label className="input-label tracking-tight">
                            Discount
                          </label>
                          <div className="flex bg-[#008C9C]/5 rounded-lg p-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                setDiscountMode("percent");
                                setDiscountTouched(true);
                              }}
                              disabled={disableForm}
                              className={`px-2 py-0.5 text-[11px] rounded-md transition-colors ${
                                discountMode === "percent"
                                  ? "bg-[#008C9C] text-white"
                                  : "text-[#008C9C]/60"
                              }`}>
                              %
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDiscountMode("amount");
                                setDiscountTouched(true);
                              }}
                              disabled={disableForm}
                              className={`px-2 py-0.5 text-[11px] rounded-md transition-colors ${
                                discountMode === "amount"
                                  ? "bg-[#008C9C] text-white"
                                  : "text-[#008C9C]/60"
                              }`}>
                              $
                            </button>
                          </div>
                        </div>
                        <div className="relative">
                          <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#008C9C]/50" />
                          <Input
                            variant="form"
                            type="number"
                            size="md"
                            step="0.01"
                            min="0"
                            value={discountInput}
                            onChange={(e) => {
                              setDiscountInput(e.target.value);
                              setDiscountTouched(true);
                            }}
                            disabled={disableForm}
                            className="w-full pl-11 px-4 py-3"
                            placeholder={discountMode === "percent" ? "0" : "0.00"}
                            border={false}
                          />
                        </div>
                        {!discountTouched &&
                          (() => {
                            const linked = clients.find(
                              (c) => c.id === selectedClientId
                            );
                            return linked && (linked.discountPercent ?? 0) > 0 ? (
                              <p className="text-[11px] text-[#008C9C]/60 mt-1">
                                From client default ({linked.discountPercent}%)
                              </p>
                            ) : null;
                          })()}
                      </div>

                      {/* Item 29: why the discount was given. Only shown when
                          there IS a discount — asking for a reason on a job
                          with no discount is noise. */}
                      {discountIsSet && (
                        <div className="sm:col-span-2">
                          <label className="input-label tracking-tight">
                            Discount reason
                          </label>
                          <div className="flex gap-2 flex-wrap">
                            <select
                              value={
                                discountReason === "" ||
                                DISCOUNT_REASONS.includes(
                                  discountReason as (typeof DISCOUNT_REASONS)[number]
                                )
                                  ? discountReason
                                  : "Other"
                              }
                              onChange={(e) => setDiscountReason(e.target.value)}
                              disabled={disableForm}
                              className="flex-1 min-w-[10rem] px-4 py-3 rounded-xl bg-[#008C9C]/5 text-sm text-[#008C9C] focus:outline-none">
                              <option value="">Select a reason…</option>
                              {DISCOUNT_REASONS.map((r) => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </select>
                            {/* "select OR enter" — picking Other (or editing a
                                custom value) reveals free text. */}
                            {(discountReason === "Other" ||
                              (discountReason !== "" &&
                                !DISCOUNT_REASONS.includes(
                                  discountReason as (typeof DISCOUNT_REASONS)[number]
                                ))) && (
                              <Input
                                variant="form"
                                size="md"
                                value={discountReason === "Other" ? "" : discountReason}
                                onChange={(e) => setDiscountReason(e.target.value)}
                                disabled={disableForm}
                                placeholder="Type the reason"
                                className="flex-1 min-w-[12rem] px-4 py-3"
                                border={false}
                              />
                            )}
                          </div>
                          {!discountReason && (
                            <p className="text-[11px] text-[#008C9C]/60 mt-1">
                              Optional, but it appears in job details and
                              reporting — blank shows as &quot;{NO_REASON_LABEL}&quot;.
                            </p>
                          )}
                        </div>
                      )}

                      {/* Item 7: per-job sales-tax exemption. Applies to THIS
                          job only — there is no global switch here. */}
                      <div className="sm:col-span-2">
                        <label className="input-label tracking-tight">
                          Sales tax
                        </label>
                        <label
                          className={`flex items-start gap-2 rounded-xl px-3 py-2.5 cursor-pointer border ${
                            taxExempt
                              ? "bg-amber-50 border-amber-200"
                              : "bg-[#008C9C]/5 border-transparent"
                          }`}>
                          <input
                            type="checkbox"
                            checked={taxExempt}
                            onChange={(e) => setTaxExempt(e.target.checked)}
                            disabled={disableForm}
                            className="mt-0.5"
                          />
                          <span className="text-xs">
                            <span className="font-[500] text-[#008C9C]">
                              Exempt this job from sales tax
                            </span>
                            <span className="block text-[#008C9C]/60 mt-0.5">
                              {taxExempt
                                ? "Taxes EXCLUDED — no GST/QST on this job. Cleaner pay is unaffected (always calculated before tax)."
                                : "Taxes INCLUDED — GST/QST are added to this job's total."}
                            </span>
                          </span>
                        </label>
                      </div>

                      <div>
                        <label className="input-label tracking-tight">
                          Bed Count
                        </label>
                        <Input
                          variant="form"
                          type="number"
                          size="md"
                          min="0"
                          {...register("bedCount")}
                          disabled={disableForm}
                          className="w-full px-4 py-3"
                          placeholder="0"
                          border={false}
                        />
                      </div>

                      <div>
                        <label className="input-label tracking-tight">
                          Bath Count
                        </label>
                        <Input
                          variant="form"
                          type="number"
                          size="md"
                          min="0"
                          {...register("bathCount")}
                          disabled={disableForm}
                          className="w-full px-4 py-3"
                          placeholder="0"
                          border={false}
                        />
                      </div>

                      <div>
                        <label className="input-label tracking-tight">
                          Half Bath Count
                        </label>
                        <Input
                          variant="form"
                          type="number"
                          size="md"
                          min="0"
                          {...register("halfBathCount")}
                          disabled={disableForm}
                          className="w-full px-4 py-3"
                          placeholder="0"
                          border={false}
                        />
                      </div>

                      {/* Item 8: Square Footage. Stored on every job as
                          property info; only drives the price on square-foot
                          priced services (move in / move out). */}
                      <div className="sm:col-span-2">
                        <label className="input-label tracking-tight">
                          Square Footage
                        </label>
                        <Input
                          variant="form"
                          type="number"
                          size="md"
                          min="0"
                          {...register("squareFootage")}
                          disabled={disableForm}
                          className="w-full px-4 py-3"
                          placeholder="e.g. 1200"
                          border={false}
                        />
                        <p className="text-[11px] text-[#008C9C]/60 mt-1">
                          {sqftPriced ? (
                            sqftDerivedPrice !== null ? (
                              <>
                                This service is priced per square foot —{" "}
                                <strong>${sqftDerivedPrice.toFixed(2)}</strong> at{" "}
                                {watchedSqft} sq ft.{" "}
                                {watchedPrice
                                  ? "Your entered price is used instead."
                                  : "Leave Price blank to use it."}
                              </>
                            ) : (
                              "This service is priced per square foot — enter the area to calculate the price."
                            )
                          ) : (
                            "Saved as job information. This service isn't priced per square foot, so it won't change the price."
                          )}
                        </p>
                      </div>

                      <div className="col-span-2">
                        <label className="input-label tracking-tight">
                          Payment Type
                        </label>
                        <CustomDropdown
                          trigger={
                            <Button
                              variant="default"
                              size="md"
                              border={false}
                              type="button"
                              disabled={disableForm}
                              className="w-full h-[44px] px-4 py-3 flex items-center !justify-between bg-[#008C9C]/5">
                              <span className="text-sm font-[350] text-[#008C9C]">
                                {selectedPaymentType
                                  ? selectedPaymentType.replace("_", " ")
                                  : "Select payment type"}
                              </span>
                              <ChevronDown className="w-4 h-4 text-[#008C9C]/50" />
                            </Button>
                          }
                          options={[
                            {
                              label: "— None —",
                              onClick: () => setSelectedPaymentType(""),
                            },
                            {
                              label: "Cash",
                              onClick: () => setSelectedPaymentType("CASH"),
                            },
                            {
                              label: "Cheque",
                              onClick: () => setSelectedPaymentType("CHEQUE"),
                            },
                            {
                              label: "E-Transfer",
                              onClick: () =>
                                setSelectedPaymentType("E_TRANSFER"),
                            },
                            {
                              label: "Credit Card",
                              onClick: () =>
                                setSelectedPaymentType("CREDIT_CARD"),
                            },
                            {
                              label: "Other",
                              onClick: () => setSelectedPaymentType("OTHER"),
                            },
                          ]}
                          maxHeight="14rem"
                        />
                      </div>
                    </div>

                    {/* Card on file: shown when CREDIT_CARD selected and
                        the chosen client has no saved payment method. */}
                    {selectedPaymentType === "CREDIT_CARD" && (() => {
                      const selectedClient = clients.find(
                        (c) => c.id === selectedClientId
                      );
                      if (!selectedClientId || !selectedClient) {
                        return (
                          <div
                            style={{
                              marginTop: 12,
                              padding: 12,
                              background: "#fef3c7",
                              border: "1px solid #fde68a",
                              borderRadius: 10,
                              fontSize: 12.5,
                              color: "#854d0e",
                              lineHeight: 1.5,
                            }}>
                            To save a card on file, pick an existing client from the search above. For a brand-new client, save the job first then add the card from their client profile.
                          </div>
                        );
                      }
                      if (selectedClient.defaultPaymentMethodId || cardSavedNow) {
                        return (
                          <div
                            style={{
                              marginTop: 12,
                              padding: "8px 12px",
                              background: "#dcfce7",
                              color: "#166534",
                              fontSize: 13,
                              fontWeight: 600,
                              borderRadius: 8,
                            }}>
                            ✓ Card on file. Charges will run off-session.
                          </div>
                        );
                      }
                      return (
                        <SaveCardOnFile
                          clientId={selectedClient.id}
                          clientName={selectedClient.name}
                          clientEmail={selectedClient.email ?? null}
                          onSaved={() => setCardSavedNow(true)}
                        />
                      );
                    })()}
                  </div>

                  {/* Add-Ons Section */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-[400] text-[#008C9C] uppercase tracking-tight flex items-center gap-2">
                      <Briefcase className="w-4 h-4" />
                      Add-Ons
                    </h3>
                    {/* The pickers stay fully available in override mode — the
                        add-ons still define the SCOPE of the job (what the
                        cleaner does, what the checklist triggers) even when they
                        do not move the money. Saying so out loud is the point:
                        a silently inert picker is what made an admin think the
                        add-on hadn't saved. */}
                    {pricingMode === "FINAL_PRICE" && (
                      <p className="text-xs text-[#854d0e] bg-[#fef3c7] rounded-lg px-3 py-2">
                        This job is on a final price override, so add-ons are{" "}
                        {ADDON_INCLUDED_LABEL} — pick them to record the scope;
                        they will not change the total.
                      </p>
                    )}
                    {addOnCatalog.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs text-[#008C9C]/60">
                          Quick add from your configured add-ons:
                        </p>
                        {/* Icon cards (spec item 22) — icon + name + price,
                            scannable grid instead of text pills. Click toggles. */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {/* Matched with addOnKey — the canonical normalizer,
                              which also collapses inner whitespace, so
                              "Inside  Fridge" stops reading as a second add-on
                              that the picker can never un-toggle. */}
                          {addOnCatalog.map((cat) => {
                            const catKey = addOnKey(cat.name);
                            const chosen = addOns.find(
                              (a) => addOnKey(a.name) === catKey
                            );
                            const already = !!chosen;
                            const Icon = addonIcon(cat);
                            return (
                              <button
                                key={cat.id}
                                type="button"
                                disabled={disableForm}
                                onClick={() =>
                                  setAddOns((prev) =>
                                    already
                                      ? prev.filter(
                                          (a) => addOnKey(a.name) !== catKey
                                        )
                                      : [
                                          ...prev,
                                          {
                                            rowId: nextAddOnRowId(),
                                            name: cat.name,
                                            price: cat.price,
                                            quantity: 1,
                                          },
                                        ]
                                  )
                                }
                                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-colors ${
                                  already
                                    ? "bg-[#008C9C]/10 border-[#008C9C] text-[#008C9C]"
                                    : "bg-white border-[#008C9C]/20 text-[#008C9C] hover:border-[#008C9C]/50"
                                }`}>
                                <Icon className="w-5 h-5" />
                                <span className="text-xs font-[450] leading-tight">
                                  {cat.name}
                                </span>
                                <span className="text-[11px] text-[#008C9C]/70">
                                  ${cat.price.toFixed(2)}
                                </span>
                                {already && (
                                  <span className="text-[10px] font-[600]">
                                    ✓ Added
                                    {chosen!.quantity > 1 ? ` ×${chosen!.quantity}` : ""}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {addOns.length > 0 && (
                      <div className="space-y-2">
                        {addOns.map((a) => {
                          const isCustom = !catalogAddOnKeys.has(addOnKey(a.name));
                          return (
                            <div
                              key={a.rowId}
                              className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-[#008C9C]/5">
                              <Input
                                variant="form"
                                size="md"
                                value={a.name}
                                onChange={(e) =>
                                  updateAddOn(a.rowId, { name: e.target.value })
                                }
                                disabled={disableForm}
                                aria-label="Add-on name"
                                className="flex-1 min-w-[8rem] px-3 py-2"
                                border={false}
                              />
                              {isCustom && (
                                <span className="text-[10px] font-[600] uppercase tracking-wide px-2 py-0.5 rounded-full bg-[#008C9C]/10 text-[#008C9C]">
                                  custom
                                </span>
                              )}
                              <Input
                                variant="form"
                                type="number"
                                size="md"
                                step="0.01"
                                min="0"
                                value={String(a.price)}
                                onChange={(e) =>
                                  updateAddOn(a.rowId, {
                                    price: Number(e.target.value) || 0,
                                  })
                                }
                                disabled={disableForm}
                                aria-label="Unit price"
                                className="w-24 px-3 py-2"
                                border={false}
                              />
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  aria-label={`Decrease ${a.name || "add-on"} quantity`}
                                  disabled={disableForm || a.quantity <= 1}
                                  onClick={() =>
                                    updateAddOn(a.rowId, {
                                      quantity: Math.max(1, a.quantity - 1),
                                    })
                                  }
                                  className="w-7 h-7 rounded-full bg-white text-[#008C9C] disabled:opacity-40">
                                  −
                                </button>
                                <span className="w-6 text-center text-sm text-[#008C9C]">
                                  {a.quantity}
                                </span>
                                <button
                                  type="button"
                                  aria-label={`Increase ${a.name || "add-on"} quantity`}
                                  disabled={
                                    disableForm || a.quantity >= MAX_ADDON_QUANTITY
                                  }
                                  onClick={() =>
                                    updateAddOn(a.rowId, {
                                      quantity: Math.min(
                                        MAX_ADDON_QUANTITY,
                                        a.quantity + 1
                                      ),
                                    })
                                  }
                                  className="w-7 h-7 rounded-full bg-white text-[#008C9C] disabled:opacity-40">
                                  +
                                </button>
                              </div>
                              <span className="text-sm font-[500] text-[#008C9C] w-20 text-right">
                                ${addOnLineTotal(a).toFixed(2)}
                              </span>
                              <button
                                type="button"
                                className="text-xs text-red-600"
                                onClick={() =>
                                  setAddOns((prev) =>
                                    prev.filter((r) => r.rowId !== a.rowId)
                                  )
                                }>
                                remove
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="space-y-2 pt-1">
                      <p className="text-xs font-[600] text-[#008C9C]">
                        Custom extra charge
                      </p>
                      <p className="text-xs text-[#008C9C]/60">
                        Not in your catalog? Add a one-off charge to this job. It
                        is billed and taxed like any other add-on.
                      </p>
                      <div className="flex gap-2">
                        <Input
                          variant="form"
                          size="md"
                          value={newAddOnName}
                          onChange={(e) => setNewAddOnName(e.target.value)}
                          onKeyDown={handleNewAddOnKeyDown}
                          disabled={disableForm}
                          aria-label="Custom charge name"
                          placeholder="e.g. Balcony deep clean"
                          className="flex-1 px-4 py-3"
                          border={false}
                        />
                        <Input
                          variant="form"
                          type="number"
                          size="md"
                          step="0.01"
                          min="0"
                          value={newAddOnPrice}
                          onChange={(e) => setNewAddOnPrice(e.target.value)}
                          onKeyDown={handleNewAddOnKeyDown}
                          disabled={disableForm}
                          aria-label="Custom charge price"
                          placeholder="0.00"
                          className="w-28 px-4 py-3"
                          border={false}
                        />
                        <Button
                          type="button"
                          variant="default"
                          size="md"
                          border={false}
                          disabled={disableForm || !newAddOnValid}
                          onClick={addCustomCharge}
                          className="px-4 py-3">
                          Add
                        </Button>
                      </div>
                      {newAddOnName.trim() &&
                        newAddOnPrice.trim() &&
                        !Number.isFinite(parseFloat(newAddOnPrice)) && (
                          <p className="text-xs text-red-600">
                            Enter a price, e.g. 25 or 25.00.
                          </p>
                        )}
                    </div>
                  </div>

                  {/* Live total — the modal had no total of any kind, so an
                      admin could not see what a job would actually bill until
                      after saving it. Driven by the same helper the job detail
                      page, the receipt and the charge path use. */}
                  <div className="space-y-2 p-4 rounded-xl bg-[#008C9C]/5">
                    <h3 className="text-sm font-[400] text-[#008C9C] uppercase tracking-tight">
                      Total
                    </h3>
                    {previewMoney.addOnsIncludedInSubtotal && (
                      <p className="text-xs text-[#008C9C]/60">
                        This booking&apos;s add-ons are already inside its
                        service total, so they are itemised here rather than
                        added.
                      </p>
                    )}
                    {/* Both figures, labelled, whenever they disagree — the PDF
                        asks for exactly this, because an override job showing a
                        single number gives the admin no way to tell whether the
                        total is the one they typed or the one the parts add up
                        to. Plus the escape hatch back to itemized. */}
                    {previewTotalsDiffer && (
                      <div className="space-y-1 pb-2 mb-1 border-b border-[#008C9C]/15">
                        <div className="flex justify-between text-xs text-[#008C9C]/60">
                          <span>Calculated from items</span>
                          <span>${previewItemizedTotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-xs font-[600] text-[#008C9C]">
                          <span>Active override total</span>
                          <span>${previewMoney.subtotalAmount.toFixed(2)}</span>
                        </div>
                        {/* Deliberately does NOT rewrite the Price field. The
                            field already holds the base service line; itemized
                            mode adds the add-ons to it, which is where
                            ${previewItemizedTotal.toFixed(2)} comes from.
                            Copying that figure INTO the price would add them a
                            second time. */}
                        <button
                          type="button"
                          disabled={disableForm}
                          onClick={() => changePricingMode("ITEMIZED", true)}
                          className="text-xs font-[600] text-[#008C9C] underline underline-offset-2 disabled:opacity-60">
                          Recalculate from items (${previewItemizedTotal.toFixed(2)})
                        </button>
                      </div>
                    )}
                    <div className="flex justify-between text-sm text-[#008C9C]">
                      <span>Base price</span>
                      <span>${previewMoney.basePrice.toFixed(2)}</span>
                    </div>
                    {previewMoney.addOnTotal > 0 && (
                      <div className="flex justify-between text-sm text-[#008C9C]">
                        <span>Add-ons &amp; extra charges</span>
                        <span>
                          {previewMoney.addOnsIncludedInSubtotal ? "" : "+"}$
                          {previewMoney.addOnTotal.toFixed(2)}
                        </span>
                      </div>
                    )}
                    {previewMoney.discountApplied > 0 && (
                      <div className="flex justify-between text-sm text-[#008C9C]">
                        <span>Discount</span>
                        <span>−${previewMoney.discountApplied.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-[600] text-[#008C9C] border-t border-[#008C9C]/15 pt-2">
                      <span>
                        Subtotal
                        {pricingMode === "FINAL_PRICE" && (
                          <span className="ml-2 font-[400] text-xs text-[#008C9C]/60">
                            override total — active
                          </span>
                        )}
                      </span>
                      <span>${previewMoney.subtotalAmount.toFixed(2)}</span>
                    </div>
                    {previewMoney.exempt ? (
                      <div className="flex justify-between text-sm text-[#854d0e]">
                        <span>Tax exempt</span>
                        <span>$0.00</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between text-sm text-[#008C9C]">
                          <span>GST ({taxRates.gstRate}%)</span>
                          <span>+${previewMoney.gstAmount.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm text-[#008C9C]">
                          <span>QST ({taxRates.qstRate}%)</span>
                          <span>+${previewMoney.qstAmount.toFixed(2)}</span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between text-base font-[600] text-[#008C9C] border-t border-[#008C9C]/15 pt-2">
                      <span>Total</span>
                      <span>${previewMoney.totalAmount.toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Notes Section */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-[400] text-[#008C9C] uppercase tracking-tight flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      Additional Notes
                    </h3>

                    <Textarea
                      size="md"
                      {...register("notes")}
                      disabled={disableForm}
                      className="w-full px-4 py-3 min-h-[120px] bg-[#008C9C]/5 border-0 focus:ring-1 focus:ring-[#008C9C]/20 rounded-2xl tracking-tight placeholder:tracking-tight"
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
              <div className="w-full flex flex-col md:flex-row justify-between pt-6 items-center border-[#008C9C]/10 gap-4">
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

// ── Client search picker ─────────────────────────────────────────────────
function ClientSearchPicker({
  clients,
  selectedClientId,
  disabled,
  onSelect,
  onClear,
}: {
  clients: ClientLite[];
  selectedClientId: string;
  disabled?: boolean;
  onSelect: (c: ClientLite) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const selected = selectedClientId
    ? clients.find((c) => c.id === selectedClientId) ?? null
    : null;

  const filtered = (() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients.slice(0, 20);
    return clients
      .filter((c) => {
        // Phone included (item 4) — an admin who has the customer on the line
        // usually has their number, not the spelling of their name.
        const haystack =
          `${c.name} ${c.email ?? ""} ${c.phone ?? ""} ${c.address ?? ""}`.toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 20);
  })();

  return (
    <div ref={wrapperRef} className="relative">
      <label className="input-label tracking-tight">
        Link to Existing Client (optional)
      </label>

      {selected ? (
        <div
          className="w-full flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl bg-[#008C9C]/5 border border-[#008C9C]/10"
          style={{ minHeight: 44 }}>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-[450] text-[#008C9C] truncate">
              {selected.name}
            </div>
            <div className="text-xs text-[#008C9C]/60 truncate">
              {selected.email ?? "—"}
              {selected.address ? ` · ${selected.address}` : ""}
            </div>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onClear();
              setQuery("");
            }}
            className="text-xs text-[#008C9C]/70 hover:text-[#008C9C] px-2 py-1">
            Change
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            type="text"
            value={query}
            disabled={disabled}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search clients by name, email, phone, or address…"
            className="w-full h-[44px] px-4 py-3 rounded-xl bg-[#008C9C]/5 text-sm text-[#008C9C] placeholder:text-[#008C9C]/50 outline-none focus:bg-[#008C9C]/10"
          />
          {open && (
            <div
              className="absolute left-0 right-0 mt-1 z-30 rounded-xl bg-white border border-[#008C9C]/10 shadow-lg"
              style={{ maxHeight: 280, overflowY: "auto" }}>
              {filtered.length === 0 ? (
                <div className="px-4 py-3 text-sm text-[#008C9C]/60">
                  No matches. Enter the name below to create a new client.
                </div>
              ) : (
                filtered.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      onSelect(c);
                      setQuery("");
                      setOpen(false);
                    }}
                    className="w-full text-left px-4 py-2.5 hover:bg-[#008C9C]/5 flex flex-col gap-0.5 border-b border-[#008C9C]/5 last:border-b-0">
                    <span className="text-sm font-[450] text-[#008C9C]">
                      {c.name}
                    </span>
                    <span className="text-xs text-[#008C9C]/60 truncate">
                      {c.email ?? "—"}
                      {c.address ? ` · ${c.address}` : ""}
                      {c.defaultPaymentMethodId ? " · 💳 card on file" : ""}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
