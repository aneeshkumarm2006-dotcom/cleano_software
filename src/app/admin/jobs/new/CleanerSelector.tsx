"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import Input from "@/components/ui/Input";
import { X, Search, Users, AlertTriangle } from "lucide-react";
import Badge from "@/components/ui/Badge";
import { checkAvailabilityBatch } from "../../actions/checkAvailability";
import type { EmployeeAvailabilityStatus } from "../../actions/checkAvailability.types";
import {
  StatusIndicator,
  CategoryIndicator,
  AssignmentWarningPanel,
  AvailabilityLink,
} from "@/components/admin/AssignmentIndicators";
import { categoryMismatchWarning } from "@/lib/service-permissions";
import { checkCustomCleanerPay } from "@/lib/job-money";
import { crewPayBudget, readJobFormMoney } from "./form-money";

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
  /**
   * Total of the add-on rows the job being edited already owns. This page has
   * no add-on editor, so they are invisible to a DOM read — but they are part
   * of what the job is worth, and therefore part of what it can pay a crew
   * (item #10). Zero on a new job, which genuinely has none.
   */
  addOnTotal?: number;
  /**
   * How many cleaners the job needs. Prefilled from the job being edited or
   * duplicated, 1 on a blank form — the same default the column carries.
   */
  defaultRequiredCleaners?: number;
  /**
   * The per-cleaner overrides the job being EDITED already has stored
   * (`JobAssignment.payAmount`), keyed by cleaner id. Empty on a new job.
   *
   * These boxes used to start blank on an edit as well, and a blank box means
   * "leave as-is" — so the cap below saw `null` for every cleaner who already
   * had an override, and the form would happily drop a $100 job's price while
   * $120 of crew pay stood untouched underneath it. Prefilling is the honest
   * fix: the admin can SEE what the job already promises, which is the thing
   * the cap is about to judge them on.
   *
   * Only the job being edited feeds this — never a duplicate. A duplicate is a
   * NEW job, and carrying one job's hand-split payroll onto another without
   * being asked is a decision, not a prefill.
   */
  initialCustomPay?: Record<string, number>;
  /**
   * How far over its ceiling those stored overrides ALREADY put this job, in
   * dollars. 0 on a new job and on every job whose payroll currently fits.
   *
   * The cap refuses an edit that makes the overshoot WORSE, not one that merely
   * arrives on a job that is already over — the same "corrections are never
   * refused" rule setCleanerJobPay follows, and for the same reason: jobs
   * written before this cap existed are still out there, and an admin changing
   * such a job's address must not be held hostage to its payroll.
   */
  initialOvershoot?: number;
}

type StatusMap = Map<string, EmployeeAvailabilityStatus>;

export default function CleanerSelector({
  users,
  initialSelectedIds = [],
  addOnTotal = 0,
  defaultRequiredCleaners = 1,
  initialCustomPay = {},
  initialOvershoot = 0,
}: CleanerSelectorProps) {
  const [searchTerm, setSearchTerm] = useState("");
  // ── "Cleaners needed" (fix list item #4) ───────────────────────────────────
  //
  // This form did not ask, so every job created from it was born needing one
  // cleaner: assign two and the calendar read "Professionals 2 of 1 assigned",
  // and the whole staffing story downstream — open spots in the cleaner app,
  // the shortfall clockOut logs, the amber warnings on the job — keyed off a
  // number the creating admin was never shown. Only the Edit modal had the
  // field, which is a poor place to learn that the job you just booked is
  // considered fully staffed.
  //
  // Kept as a string so the box can be emptied while typing (a number state
  // would snap a half-typed "" back to 1 under the cursor); the count read from
  // it is clamped everywhere it is used, and the action clamps again server-side.
  const [requiredCleaners, setRequiredCleaners] = useState(
    String(defaultRequiredCleaners || 1),
  );
  const requiredCount = Math.min(
    20,
    Math.max(1, parseInt(requiredCleaners, 10) || 1),
  );
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
  // The scheduled window, mirrored out of the same poll. Only the deep link into
  // /admin/availability (Stage 12.5) reads it — the availability lookup itself
  // sends the values straight through without storing them.
  // (Named `formWindow`, not `window` — this file calls the real
  // `window.addEventListener` further down.)
  const [formWindow, setFormWindow] = useState<{
    startDate: string;
    startTime: string;
    endTime: string;
  }>({ startDate: "", startTime: "", endTime: "" });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);

  // ── The per-cleaner pay cap (fix list item #10) ────────────────────────────
  //
  // The `payFor_<id>` boxes at the bottom of this component used to be
  // write-only: nothing compared what they added up to against what the job was
  // worth, so a $200 job could be saved promising two cleaners $150 each and
  // the overshoot only ever surfaced afterwards, as a −$100 net profit on the
  // Financials tab. These are the client half of the check — the amounts as
  // typed, and the ceiling read off the money fields further down the form.
  //
  // This one BLOCKS, unlike the amber panel above it. An admin knowingly
  // booking a cleaner outside their hours is an allowed decision, so those
  // warnings never block; promising a crew more than the job collects is not
  // the same kind of statement. STATUS_SEPT_9 §#10 calls it a *guarantee*, and
  // a guarantee that can be clicked past is not one. Blocking here also costs
  // nothing that cannot be undone in the same breath — lower an amount, or
  // raise the job total — and punishes no third party, which is the actual
  // reason the staffing advisories refuse to.
  //
  // Seeded from the overrides the job already has (see `initialCustomPay`), so
  // an edit starts out telling the truth about what the crew is promised. A
  // cleaner with no stored override keeps an empty box — "use the automatic
  // amount" — and the save path still reads blank as "leave as-is", so an
  // untouched edit re-posts only the amounts that were already there, at the
  // values they already had.
  const [customPay, setCustomPay] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(initialCustomPay).map(([id, amount]) => [
        id,
        String(amount),
      ])
    )
  );
  const [payBudget, setPayBudget] = useState(0);
  // Whether that ceiling is an agreed crew total or the job's own value, so the
  // message below can name the right thing rather than call an Employee pay
  // figure "what the job is worth".
  const [budgetIsTeamTotal, setBudgetIsTeamTotal] = useState(false);
  // The live boxes, so the cap can hang a native validation message on them and
  // let the browser refuse the submit — no disabled button to reason about, and
  // no second copy of "is this form OK" for someone to forget to update.
  const payInputRefs = useRef(new Map<string, HTMLInputElement>());

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
      // The crew's pay ceiling, re-read every tick and ABOVE the early return
      // below: the money fields change independently of the schedule, and an
      // admin who edits the price must not have to touch a date before the cap
      // notices. An unchanged number bails out of setState, so this is free.
      const budget = crewPayBudget(readJobFormMoney(), addOnTotal);
      setPayBudget(budget.amount);
      setBudgetIsTeamTotal(budget.fromTeamTotal);

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
      // Same for the availability deep link: it is a URL, not a query.
      setFormWindow({ startDate, startTime, endTime });

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
  }, [userIds, addOnTotal]);

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

  // The cap itself, from the same helper the server action uses so the two
  // cannot disagree about the arithmetic. `crewPayBudget` has already picked
  // WHICH total applies (an agreed team total, or what the job is worth), so
  // the checker is handed one resolved number.
  const payCheck = useMemo(
    () =>
      checkCustomCleanerPay({
        payBasis: payBudget,
        amounts: selectedCleaners.map((c) => {
          const raw = (customPay[c.id] ?? "").trim();
          // An EMPTIED box is not a cleared override. `applyManualPayouts`
          // reads a blank `payFor_<id>` as "leave as-is", so a cleaner who
          // already had a stored amount is still promised it — and the server
          // half of this cap falls back to exactly that stored figure. Count
          // it here too, or the two halves disagree about what the crew is
          // owed: clearing a prefilled $70 box and typing $150 for the other
          // cleaner looked fine on this form ($150 of $200) and then hit the
          // server as $220, which threw the save onto a raw "Application
          // error" page with the admin's edits lost. Clearing a box back to
          // the automatic amount is done from the job detail page's Reset
          // control, which is the surface that can actually express it.
          if (raw === "") return initialCustomPay[c.id] ?? null;
          const n = Number(raw);
          return Number.isFinite(n) ? n : null;
        }),
      }),
    [selectedCleaners, customPay, payBudget, initialCustomPay]
  );

  // Refuse the submit through the browser's own constraint validation. A custom
  // message on any input is enough for the form to stop — and because the
  // action is a server action reached by a normal submit, that stop happens
  // before the round trip, not after a save the admin then has to undo. The
  // panel below says the same thing in place, since a native bubble is easy to
  // dismiss and never comes back on its own.
  // What the ceiling IS, in the admin's own words — "the crew's agreed
  // $150.00" reads as a mistake they can act on; "this job's $150.00" reads as
  // the price, which it is not.
  const budgetLabel = budgetIsTeamTotal
    ? `the crew's agreed $${payCheck.budget.toFixed(2)}`
    : `this job's $${payCheck.budget.toFixed(2)}`;

  // Over budget is not the same question as "this edit is what put it there".
  // A job saved before this cap existed can arrive already over; refusing every
  // save on it would make its address, its notes and its schedule unreachable
  // over a payroll figure the admin may not be the one to decide. So the block
  // is on WORSENING the overshoot — which still refuses the two things that
  // opened this hole (dropping the price under the stored payouts, and typing
  // an amount while another cleaner's stored one hides) and refuses no
  // correction. Whole cents on both sides, so an untouched edit cannot trip on
  // a float a fraction of a cent high. Same shape as setCleanerJobPay's
  // before/after comparison, and the server half of this check agrees.
  const payBlocks =
    payCheck.overBudget &&
    Math.round(payCheck.overshoot * 100) >
      Math.round(Math.max(0, initialOvershoot) * 100);

  useEffect(() => {
    const message = payBlocks
      ? `Custom pay adds up to $${payCheck.custom.toFixed(2)} — $${payCheck.overshoot.toFixed(2)} more than ${budgetLabel}. Lower the amounts, or raise the total it comes out of.`
      : "";
    for (const el of payInputRefs.current.values()) {
      el.setCustomValidity(message);
    }
  }, [payBlocks, payCheck, budgetLabel]);

  // Adding or removing a cleaner changes the crew's cost, but it fires no
  // `input` event — and PriceSummary, several sections below, only re-reads the
  // form on one. Without this nudge its Net margin would keep counting a
  // removed cleaner's custom amount until the admin happened to type somewhere
  // else. Same trick EmployeePayModeField already uses to keep the pay box
  // honest across an uncontrolled form.
  useEffect(() => {
    document.dispatchEvent(new Event("input", { bubbles: true }));
  }, [selectedCleaners]);

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
      // Putting back a cleaner who was removed in this same session restores
      // the override the job still has stored for them. Their JobAssignment row
      // is never deleted until the form is actually saved, so leaving the box
      // blank would say "auto" while the save — and the server's cap — would
      // still be looking at their stored amount.
      const stored = initialCustomPay[user.id];
      if (stored !== undefined) {
        setCustomPay((prev) =>
          user.id in prev ? prev : { ...prev, [user.id]: String(stored) }
        );
      }
    }
    setSearchTerm("");
    setIsDropdownOpen(false);
  };

  const handleRemoveCleaner = (userId: string) => {
    setSelectedCleaners(selectedCleaners.filter((c) => c.id !== userId));
    // Drop their custom amount too. It is submitted as `payFor_<id>` and read
    // back per assigned cleaner, so a stray entry would post nothing — but it
    // would keep counting toward the cap above, and refuse a submit over money
    // nobody is being paid.
    setCustomPay((prev) => {
      if (!(userId in prev)) return prev;
      const next = { ...prev };
      delete next[userId];
      return next;
    });
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
      {/* Same control, same copy and same place as the Edit modal's — one job
          form must not describe a job differently from the other. Above the
          picker, because it is the question the picking is an answer to. */}
      <div className="flex flex-wrap items-end gap-3">
        <div style={{ width: 150 }}>
          <label className="input-label" htmlFor="requiredCleaners">
            Cleaners needed
          </label>
          <input
            id="requiredCleaners"
            name="requiredCleaners"
            type="number"
            min={1}
            max={20}
            step={1}
            className="input"
            value={requiredCleaners}
            onChange={(e) => setRequiredCleaners(e.target.value)}
          />
        </div>
        {/* Said out loud while the admin is still on the crew picker, rather
            than discovered on the day. The cleaner app counts open spots
            against this number, so a job left short here simply never fills. */}
        {requiredCount > selectedCleaners.length && (
          <p className="text-sm text-amber-700 pb-2">
            {selectedCleaners.length} of {requiredCount} assigned
            {" — "}
            {requiredCount - selectedCleaners.length} more
            {requiredCount - selectedCleaners.length === 1
              ? " spot is"
              : " spots are"}{" "}
            open to cleaners.
          </p>
        )}
      </div>

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

      {/* Stage 12.5 — into the all-cleaner availability view on this job's own
          date and window. Above the panel, not inside it: the moment an admin
          most needs to go looking for coverage is before anyone is picked, when
          the panel below renders nothing at all. */}
      <AvailabilityLink
        date={formWindow.startDate}
        startTime={formWindow.startTime}
        endTime={formWindow.endTime}
      />

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
                  value={customPay[cleaner.id] ?? ""}
                  onChange={(e) =>
                    setCustomPay((prev) => ({
                      ...prev,
                      [cleaner.id]: e.target.value,
                    }))
                  }
                  // Held so the cap can put a validation message on the box
                  // itself; the cleanup keeps a removed cleaner's input out of
                  // the map (React 19 ref cleanup).
                  ref={(el) => {
                    const map = payInputRefs.current;
                    if (el) map.set(cleaner.id, el);
                    return () => {
                      map.delete(cleaner.id);
                    };
                  }}
                  // Red where the arithmetic is wrong; `aria-invalid` only
                  // where the browser will actually refuse the value, so a
                  // screen reader is not told a field is rejected when it saves.
                  aria-invalid={payBlocks || undefined}
                  className={`w-full pl-6 pr-2 py-1.5 text-sm bg-white border rounded-lg outline-none ${
                    payCheck.overBudget
                      ? "border-red-400 focus:border-red-500"
                      : "border-gray-200 focus:border-[#008C9C]"
                  }`}
                />
              </div>
            </div>
          ))}

          {/* Red, not amber, and it means it: this is the one thing on the crew
              picker that actually stops a save. See the note beside `customPay`
              for why this warning blocks where the availability one above does
              not. */}
          {payCheck.overBudget && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertTriangle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
              <span>
                Custom pay adds up to{" "}
                <strong>${payCheck.custom.toFixed(2)}</strong>, which is{" "}
                <strong>${payCheck.overshoot.toFixed(2)}</strong> more than{" "}
                {budgetIsTeamTotal ? "the crew's agreed" : "this job's"}{" "}
                <strong>${payCheck.budget.toFixed(2)}</strong>.{" "}
                {budgetIsTeamTotal
                  ? "The per-cleaner amounts have to fit inside the Employee pay total"
                  : "The crew can't be paid more than the job is worth"}{" "}
                — lower the amounts, or raise the total they come out of.{" "}
                {payBlocks ? (
                  "This one does block the save."
                ) : (
                  <>
                    This job was already over by{" "}
                    <strong>${Math.max(0, initialOvershoot).toFixed(2)}</strong>{" "}
                    before this edit, so the save is still allowed — it is only
                    refused if you make the gap bigger.
                  </>
                )}
              </span>
            </p>
          )}
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
