"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import Input from "@/components/ui/Input";
import { X, Search, Users, CheckCircle2, AlertTriangle } from "lucide-react";
import Badge from "@/components/ui/Badge";

type AvailabilityDay =
  | "MONDAY"
  | "TUESDAY"
  | "WEDNESDAY"
  | "THURSDAY"
  | "FRIDAY"
  | "SATURDAY"
  | "SUNDAY";

interface AvailabilitySlot {
  day: AvailabilityDay;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

interface User {
  id: string;
  name: string;
  email: string;
  availability?: AvailabilitySlot[];
}

interface CleanerSelectorProps {
  users: User[];
  initialSelectedIds?: string[];
}

type AvailabilityStatus =
  | "AVAILABLE"
  | "UNAVAILABLE"
  | "OUTSIDE_HOURS"
  | "NO_DATA"
  | "NO_TIME";

const DAY_BY_INDEX: AvailabilityDay[] = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((p) => parseInt(p, 10));
  return h * 60 + m;
}

function evaluateAvailability(
  slots: AvailabilitySlot[] | undefined,
  start: Date | null,
  end: Date | null
): AvailabilityStatus {
  if (!start) return "NO_TIME";
  if (!slots || slots.length === 0) return "NO_DATA";

  const effectiveEnd = end ?? new Date(start.getTime() + 60 * 60 * 1000);
  const day = DAY_BY_INDEX[start.getDay()];
  const startMin = start.getHours() * 60 + start.getMinutes();
  const endMin = effectiveEnd.getHours() * 60 + effectiveEnd.getMinutes();

  const dailySlots = slots.filter((s) => {
    if (s.day !== day) return false;
    if (s.effectiveFrom && start < new Date(s.effectiveFrom)) return false;
    if (s.effectiveTo && start > new Date(s.effectiveTo)) return false;
    return true;
  });

  if (dailySlots.length === 0) return "OUTSIDE_HOURS";

  const overlaps = (s: AvailabilitySlot) => {
    const sStart = toMinutes(s.startTime);
    const sEnd = toMinutes(s.endTime);
    return startMin < sEnd && endMin > sStart;
  };

  const blocked = dailySlots.find((s) => !s.isAvailable && overlaps(s));
  if (blocked) return "UNAVAILABLE";

  const available = dailySlots.filter((s) => s.isAvailable);
  if (available.length === 0) return "OUTSIDE_HOURS";

  const fullyCovered = available.some((s) => {
    const sStart = toMinutes(s.startTime);
    const sEnd = toMinutes(s.endTime);
    return startMin >= sStart && endMin <= sEnd;
  });

  return fullyCovered ? "AVAILABLE" : "OUTSIDE_HOURS";
}

function StatusIndicator({ status }: { status: AvailabilityStatus }) {
  if (status === "NO_TIME" || status === "NO_DATA") return null;
  if (status === "AVAILABLE") {
    return (
      <span title="Available" className="inline-flex items-center text-green-600">
        <CheckCircle2 className="w-3.5 h-3.5" />
      </span>
    );
  }
  if (status === "UNAVAILABLE") {
    return (
      <span title="Marked unavailable" className="inline-flex items-center text-red-600">
        <X className="w-3.5 h-3.5" />
      </span>
    );
  }
  return (
    <span
      title="Outside normal hours"
      className="inline-flex items-center text-yellow-600">
      <AlertTriangle className="w-3.5 h-3.5" />
    </span>
  );
}

export default function CleanerSelector({
  users,
  initialSelectedIds = [],
}: CleanerSelectorProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCleaners, setSelectedCleaners] = useState<User[]>(() => {
    return users.filter((user) => initialSelectedIds.includes(user.id));
  });
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
  });
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [scheduledStart, setScheduledStart] = useState<Date | null>(null);
  const [scheduledEnd, setScheduledEnd] = useState<Date | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);

  // Watch the form's date/time fields so we can evaluate availability live
  useEffect(() => {
    const startDateEl = document.getElementById("startDate") as HTMLInputElement | null;
    const startTimeEl = document.getElementById("startTime") as HTMLInputElement | null;
    const endDateEl = document.getElementById("endDate") as HTMLInputElement | null;
    const endTimeEl = document.getElementById("endTime") as HTMLInputElement | null;

    const recompute = () => {
      const sd = startDateEl?.value || "";
      const st = startTimeEl?.value || "";
      const ed = endDateEl?.value || "";
      const et = endTimeEl?.value || "";

      if (sd && st) {
        const start = new Date(`${sd}T${st}`);
        setScheduledStart(Number.isNaN(start.getTime()) ? null : start);
      } else {
        setScheduledStart(null);
      }

      if (ed && et) {
        const end = new Date(`${ed}T${et}`);
        setScheduledEnd(Number.isNaN(end.getTime()) ? null : end);
      } else {
        setScheduledEnd(null);
      }
    };

    recompute();
    const els = [startDateEl, startTimeEl, endDateEl, endTimeEl].filter(
      (el): el is HTMLInputElement => !!el
    );
    els.forEach((el) => el.addEventListener("change", recompute));
    els.forEach((el) => el.addEventListener("input", recompute));
    return () => {
      els.forEach((el) => el.removeEventListener("change", recompute));
      els.forEach((el) => el.removeEventListener("input", recompute));
    };
  }, []);

  // Update dropdown position based on input position
  const updateDropdownPosition = () => {
    if (inputContainerRef.current) {
      const rect = inputContainerRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputContainerRef.current &&
        !inputContainerRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredUsers = useMemo(() => {
    const search = searchTerm.toLowerCase().trim();
    if (!search) return users;

    return users.filter(
      (user) =>
        user.name.toLowerCase().includes(search) ||
        user.email.toLowerCase().includes(search)
    );
  }, [searchTerm, users]);

  const availableUsers = useMemo(() => {
    const selectedIds = new Set(selectedCleaners.map((c) => c.id));
    return filteredUsers.filter((user) => !selectedIds.has(user.id));
  }, [filteredUsers, selectedCleaners]);

  useEffect(() => {
    if (isDropdownOpen) {
      updateDropdownPosition();
      setHighlightedIndex(0);

      const handleScrollOrResize = () => {
        updateDropdownPosition();
      };

      document.addEventListener("scroll", handleScrollOrResize, true);
      window.addEventListener("resize", handleScrollOrResize);

      return () => {
        document.removeEventListener("scroll", handleScrollOrResize, true);
        window.removeEventListener("resize", handleScrollOrResize);
      };
    }
  }, [isDropdownOpen]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [availableUsers.length]);

  useEffect(() => {
    if (isDropdownOpen && dropdownRef.current) {
      const highlightedElement = dropdownRef.current.querySelector(
        `button:nth-child(${highlightedIndex + 1})`
      ) as HTMLElement;
      if (highlightedElement) {
        highlightedElement.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      }
    }
  }, [highlightedIndex, isDropdownOpen]);

  const handleSelectCleaner = (user: User) => {
    if (!selectedCleaners.find((c) => c.id === user.id)) {
      setSelectedCleaners([...selectedCleaners, user]);
    }
    setSearchTerm("");
    setIsDropdownOpen(false);
  };

  const handleRemoveCleaner = (userId: string) => {
    setSelectedCleaners(selectedCleaners.filter((c) => c.id !== userId));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isDropdownOpen) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < availableUsers.length - 1 ? prev + 1 : prev
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;
      case "Enter":
        e.preventDefault();
        if (
          availableUsers.length > 0 &&
          highlightedIndex < availableUsers.length
        ) {
          handleSelectCleaner(availableUsers[highlightedIndex]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsDropdownOpen(false);
        break;
    }
  };

  const dropdownContent = isDropdownOpen && (
    <div
      ref={dropdownRef}
      className="fixed min-w-40 bg-white border border-gray-200 rounded-2xl !overflow-hidden shadow-lg z-[9999]"
      style={{
        top: `${dropdownPosition.top}px`,
        left: `${dropdownPosition.left}px`,
        width: `${dropdownPosition.width}px`,
      }}>
      {availableUsers.length > 0 ? (
        <div className="py-1 overflow-y-auto max-h-60">
          {availableUsers.map((user, index) => {
            const status = evaluateAvailability(
              user.availability,
              scheduledStart,
              scheduledEnd
            );
            return (
              <button
                key={user.id}
                type="button"
                onClick={() => handleSelectCleaner(user)}
                onMouseEnter={() => setHighlightedIndex(index)}
                className={`w-full px-3 py-2 text-left focus:outline-none transition-colors flex items-center justify-between gap-2 ${
                  index === highlightedIndex ? "bg-gray-100" : "hover:bg-gray-50"
                }`}>
                <div className="min-w-0">
                  <div className="font-[400] text-sm text-gray-900 truncate">
                    {user.name}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 truncate">
                    {user.email}
                  </div>
                </div>
                <StatusIndicator status={status} />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="px-4 py-8 text-center text-sm text-gray-500">
          {searchTerm
            ? `No users found matching "${searchTerm}"`
            : "All users have been selected"}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="relative" ref={inputContainerRef}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            id="cleaner-search"
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setIsDropdownOpen(true);
            }}
            onFocus={() => setIsDropdownOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="Search by name or email..."
            className="pl-10"
          />
        </div>
      </div>

      {typeof document !== "undefined" &&
        createPortal(dropdownContent, document.body)}

      {selectedCleaners.length > 0 && (
        <div>
          <p className="text-sm text-gray-600 mb-2">
            Selected: {selectedCleaners.length}
          </p>
          <div className="flex flex-wrap gap-2">
            {selectedCleaners.map((cleaner) => {
              const status = evaluateAvailability(
                cleaner.availability,
                scheduledStart,
                scheduledEnd
              );
              return (
                <Badge
                  key={cleaner.id}
                  className="inline-flex items-center gap-2 !px-3 !py-1.5"
                  variant="cleano"
                  size="md">
                  <StatusIndicator status={status} />
                  <span>{cleaner.name}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveCleaner(cleaner.id)}
                    className="hover:bg-neutral-950/10 rounded-full p-0.5 transition-colors"
                    aria-label={`Remove ${cleaner.name}`}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                </Badge>
              );
            })}
          </div>
        </div>
      )}

      {selectedCleaners.length === 0 && (
        <div className="text-sm text-gray-500 flex items-center gap-2 bg-gray-50 px-4 py-3 rounded-2xl border border-gray-200">
          <Users className="w-4 h-4" />
          <span>No team members selected yet</span>
        </div>
      )}

      {selectedCleaners.map((cleaner) => (
        <input
          key={cleaner.id}
          type="hidden"
          name="cleaners"
          value={cleaner.id}
        />
      ))}
    </div>
  );
}
