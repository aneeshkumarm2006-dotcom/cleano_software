"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import Input from "@/components/ui/Input";
import { X, Search, Users } from "lucide-react";
import Badge from "@/components/ui/Badge";
import { checkAvailabilityBatch } from "../../actions/checkAvailability";
import type { EmployeeAvailabilityStatus } from "../../actions/checkAvailability.types";
import {
  StatusIndicator,
  CategoryIndicator,
  AssignmentWarningPanel,
} from "@/components/admin/AssignmentIndicators";
import { categoryMismatchWarning } from "@/lib/service-permissions";

interface User {
  id: string;
  name: string;
  email: string;
  /** Legacy prop — availability is now evaluated server-side by the shared
   *  helper (which also knows about one-off blocked dates), so this is unused. */
  availability?: unknown;
  /** Service categories this cleaner may work. Empty = all (item 3). */
  allowedServiceCategories?: string[];
}

interface CleanerSelectorProps {
  users: User[];
  initialSelectedIds?: string[];
}

type StatusMap = Map<string, EmployeeAvailabilityStatus>;

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
  const [statuses, setStatuses] = useState<StatusMap>(() => new Map());
  // Same three-state treatment as JobModal: an in-flight or failed lookup must
  // not be silently indistinguishable from "everyone is free".
  const [availabilityState, setAvailabilityState] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  // The job type currently chosen on the form, polled the same way the date and
  // time are (JobTypeSelector also writes into a hidden input). Drives the
  // service-category advisory — awerfixes.pdf item 3.
  const [jobType, setJobType] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);

  // Availability is evaluated by the shared server helper (checkAvailability),
  // the single source of truth: recurring weekly rules PLUS one-off blocked
  // dates. The form's date/time fields are already business wall clock, so they
  // are sent through as-is — no browser-local timezone round trip.
  //
  // The pickers on this form (ControlledDatePicker / ControlledTimePicker) write
  // into React-rendered HIDDEN inputs keyed by `name`, which emit no input/change
  // events — so we poll their values and only hit the server when they actually
  // change. (The previous implementation watched `getElementById("startDate")`,
  // which never resolved, so the indicator never appeared at all.)
  const userIds = useMemo(() => users.map((u) => u.id), [users]);

  useEffect(() => {
    let lastKey = "";
    let generation = 0;

    const read = (name: string) =>
      document.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value ?? "";

    const tick = () => {
      const startDate = read("startDate");
      const startTime = read("startTime");
      const endDate = read("endDate");
      const endTime = read("endTime");
      const nextJobType = read("jobType");

      const key = [startDate, startTime, endDate, endTime, nextJobType].join("|");
      if (key === lastKey) return;
      lastKey = key;

      // Category matching is pure and local — no server round trip needed, and
      // it must still update when only the job type changed.
      setJobType(nextJobType);

      if (!startDate || !startTime || userIds.length === 0) {
        generation++;
        setStatuses(new Map());
        setAvailabilityState("idle");
        return;
      }

      const run = ++generation;
      setAvailabilityState("loading");
      checkAvailabilityBatch({
        employeeIds: userIds,
        startDate,
        startTime,
        endDate: endDate || null,
        endTime: endTime || null,
      }).then(
        (res) => {
          // Ignore results from a superseded date/time edit.
          if (run !== generation) return;
          setStatuses(
            res.success
              ? new Map(res.statuses.map((s) => [s.employeeId, s]))
              : new Map()
          );
          setAvailabilityState(res.success ? "loaded" : "error");
        },
        // The call itself can reject even though the action catches its own
        // errors; without this the failure was completely silent.
        () => {
          if (run !== generation) return;
          setStatuses(new Map());
          setAvailabilityState("error");
        }
      );
    };

    tick();
    const interval = setInterval(tick, 500);
    return () => {
      generation++;
      clearInterval(interval);
    };
  }, [userIds]);

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

  // Conflicts for the crew actually selected — shown BEFORE the job is created
  // so the admin can fix or knowingly override the clash.
  const conflicts = useMemo(() => {
    return selectedCleaners
      .map((c) => ({ cleaner: c, status: statuses.get(c.id) }))
      .filter(
        (
          x
        ): x is { cleaner: User; status: EmployeeAvailabilityStatus } =>
          !!x.status &&
          x.status.result !== "AVAILABLE" &&
          x.status.result !== "NO_DATA"
      );
  }, [selectedCleaners, statuses]);

  /** Mismatch warning for one cleaner against the chosen job type, or null. */
  const warnFor = useCallback(
    (u: User) =>
      categoryMismatchWarning(u.name, jobType, u.allowedServiceCategories),
    [jobType]
  );

  const availabilityAdvisories = useMemo(
    () =>
      conflicts.map(({ cleaner, status }) => ({
        cleanerId: cleaner.id,
        cleanerName: cleaner.name,
        detail:
          status.reason ??
          (status.result === "UNAVAILABLE"
            ? "marked unavailable"
            : "outside their availability"),
      })),
    [conflicts]
  );

  const categoryAdvisories = useMemo(
    () =>
      selectedCleaners
        .map((c) => ({ cleaner: c, warning: warnFor(c) }))
        .filter((x): x is { cleaner: User; warning: string } => !!x.warning)
        .map(({ cleaner, warning }) => ({
          cleanerId: cleaner.id,
          cleanerName: cleaner.name,
          detail: warning,
        })),
    [selectedCleaners, warnFor]
  );

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
          {availableUsers.map((user, index) => (
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
              <span className="inline-flex items-center gap-1.5">
                <CategoryIndicator warning={warnFor(user)} />
                <StatusIndicator status={statuses.get(user.id)} />
              </span>
            </button>
          ))}
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
            {selectedCleaners.map((cleaner) => (
              <Badge
                key={cleaner.id}
                className="inline-flex items-center gap-2 !px-3 !py-1.5"
                variant="cleano"
                size="md">
                <CategoryIndicator warning={warnFor(cleaner)} />
                <StatusIndicator status={statuses.get(cleaner.id)} />
                <span>{cleaner.name}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveCleaner(cleaner.id)}
                  className="hover:bg-neutral-950/10 rounded-full p-0.5 transition-colors"
                  aria-label={`Remove ${cleaner.name}`}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Availability + service-category advisories, visible before the booking
          is saved. Advisory only — the admin can still create the job (nothing
          here blocks submit). */}
      <AssignmentWarningPanel
        availability={availabilityAdvisories}
        categories={categoryAdvisories}
        // Only speak up once there is somebody the answer could be about — the
        // lookup starts as soon as a date and time exist.
        availabilityState={
          selectedCleaners.length > 0 ? availabilityState : "idle"
        }
      />

      {/* Optional manual payout per cleaner (fix 4). Overrides the automatic
          tier/flat calc for that cleaner on this job — for free, discounted,
          courtesy or special jobs. Leave blank to use the automatic amount.
          Submitted as payFor_<id>; the cleaner sees only the final amount. */}
      {selectedCleaners.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Custom pay <span className="font-normal normal-case">(optional — overrides the automatic amount)</span>
          </p>
          {selectedCleaners.map((cleaner) => (
            <div key={cleaner.id} className="flex items-center justify-between gap-3">
              <span className="text-sm text-gray-700 truncate">{cleaner.name}</span>
              <div className="relative w-32 shrink-0">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input
                  type="number"
                  name={`payFor_${cleaner.id}`}
                  min={0}
                  step="0.01"
                  placeholder="Auto"
                  className="w-full pl-6 pr-2 py-1.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-[#008C9C]"
                />
              </div>
            </div>
          ))}
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
