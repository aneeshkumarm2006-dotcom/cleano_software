"use client";

import type { CSSProperties, KeyboardEvent, ReactElement } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Building2,
  Camera,
  Check,
  ChevronRight,
  Clock,
  Home,
  LayoutGrid,
  MapPin,
  Minus,
  Plus,
  Smartphone,
  Sparkles,
  Users,
} from "lucide-react";

/**
 * The product, on the page.
 *
 * Three surfaces — the office's week, a cleaner's phone, a customer booking —
 * built as real DOM rather than screenshots. That is a deliberate choice twice
 * over. It stays sharp on any display and animates, which a PNG cannot; and
 * more importantly, this repo's .env points at the production database, so a
 * screenshot of the running app would put real customers' names and addresses
 * on a public page. Every name, address and figure below is invented.
 *
 * The tabs are a real tab widget — roving focus, arrow keys, aria-selected —
 * not three buttons that swap a div. A visitor on a keyboard gets the same
 * thing a visitor with a mouse does.
 */

type TabKey = "office" | "cleaners" | "customers";

const TABS: { key: TabKey; label: string; icon: typeof LayoutGrid; blurb: string }[] = [
  {
    key: "office",
    label: "The office",
    icon: LayoutGrid,
    blurb: "Every crew, every job, the whole week on one screen.",
  },
  {
    key: "cleaners",
    label: "Your cleaners",
    icon: Smartphone,
    blurb: "Their own shifts, their checklist, their hours — nothing else.",
  },
  {
    key: "customers",
    label: "Your customers",
    icon: Home,
    blurb: "Priced by your rules, booked without a phone call.",
  },
];

/* ── The office: a week, colour-coded by the kind of work ─────────────────── */

const WEEK = [
  { day: "Mon", date: "11" },
  { day: "Tue", date: "12", today: true },
  { day: "Wed", date: "13" },
  { day: "Thu", date: "14" },
  { day: "Fri", date: "15" },
];

type Block = { col: number; top: number; span: number; tone: string; place: string; crew: string; time: string };

const BLOCKS: Block[] = [
  { col: 0, top: 0, span: 2, tone: "teal", place: "Willow Crescent", crew: "MJ", time: "8:00" },
  { col: 0, top: 3, span: 2, tone: "violet", place: "Fen Street", crew: "PA", time: "11:00" },
  { col: 1, top: 0, span: 3, tone: "teal", place: "Harbour Lofts", crew: "SM", time: "8:00" },
  { col: 1, top: 4, span: 2, tone: "amber", place: "Oakwood Ave", crew: "MJ", time: "13:00" },
  { col: 2, top: 1, span: 2, tone: "sky", place: "Rosemary Court", crew: "JO", time: "9:30" },
  { col: 2, top: 4, span: 3, tone: "teal", place: "Alder Mews", crew: "PA", time: "13:00" },
  { col: 3, top: 0, span: 2, tone: "green", place: "Fen Street", crew: "SM", time: "8:00" },
  { col: 3, top: 3, span: 2, tone: "violet", place: "Quay House", crew: "MJ", time: "11:00" },
  { col: 4, top: 1, span: 3, tone: "amber", place: "Birch Lane", crew: "JO", time: "9:30" },
];

function OfficeSurface() {
  return (
    <div className="mk-app" aria-hidden="true">
      <div className="mk-app-bar">
        <span className="mk-lights">
          <i /><i /><i />
        </span>
        <span className="mk-app-url">
          <b>yourcompany</b>.useawer.com
        </span>
      </div>

      <div className="mk-app-body">
        <nav className="mk-app-rail">
          <span className="mk-rail-mark" />
          <span className="mk-rail-i mk-rail-on"><LayoutGrid size={15} /></span>
          <span className="mk-rail-i"><Users size={15} /></span>
          <span className="mk-rail-i"><Building2 size={15} /></span>
          <span className="mk-rail-i"><Sparkles size={15} /></span>
        </nav>

        <div className="mk-app-main">
          <div className="mk-app-head">
            <div>
              <strong>Schedule</strong>
              <span>11 – 15 August</span>
            </div>
            <div className="mk-app-stats">
              <span><b>34</b> jobs</span>
              <span><b>6</b> cleaners</span>
              <span className="mk-stat-money"><b>$12,480</b> booked</span>
            </div>
          </div>

          <div className="mk-week-scroll">
          <div className="mk-week">
            {WEEK.map((d) => (
              <div key={d.day} className={`mk-week-head${d.today ? " mk-week-today" : ""}`}>
                <span>{d.day}</span>
                <b>{d.date}</b>
              </div>
            ))}
            <div className="mk-week-grid">
              {WEEK.map((d) => (
                <div key={d.day} className="mk-week-col" />
              ))}
              {BLOCKS.map((b, i) => (
                <div
                  key={`${b.place}-${i}`}
                  className={`mk-block mk-tone-${b.tone}`}
                  style={{
                    gridColumn: b.col + 1,
                    gridRow: `${b.top + 1} / span ${b.span}`,
                    animationDelay: `${120 + i * 45}ms`,
                  }}
                >
                  <b>{b.place}</b>
                  <span>
                    {b.time} · {b.crew}
                  </span>
                </div>
              ))}
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── The cleaner: one phone, one job, one tap ─────────────────────────────── */

const CHECKS = [
  { label: "Kitchen — surfaces and hob", done: true },
  { label: "Bathrooms — descale and polish", done: true },
  { label: "Bedrooms — change linen", done: false },
  { label: "Floors — vacuum and mop", done: false },
];

function CleanerSurface() {
  return (
    <div className="mk-phone-wrap" aria-hidden="true">
      <div className="mk-phone">
        <div className="mk-phone-notch" />
        <div className="mk-phone-screen">
          <div className="mk-ph-head">
            <div>
              <span>Tuesday, 12 August</span>
              <strong>Good morning, Maria</strong>
            </div>
            <span className="mk-ph-avatar">M</span>
          </div>

          <div className="mk-ph-card">
            <span className="mk-chip mk-chip-live">
              <i className="mk-pulse" />
              On now
            </span>
            <strong>Willow Crescent, Flat 2</strong>
            <span className="mk-ph-meta">
              <MapPin size={12} /> 1.2 km away
              <Clock size={12} /> 8:00 – 10:30
            </span>
            <span className="mk-ph-clock">
              <Check size={15} strokeWidth={3} />
              Clocked in at 7:58
            </span>
          </div>

          <p className="mk-ph-label">Checklist · 2 of 4</p>
          <ul className="mk-ph-list">
            {CHECKS.map((c) => (
              <li key={c.label} className={c.done ? "mk-done" : ""}>
                <span className="mk-tick">{c.done && <Check size={11} strokeWidth={4} />}</span>
                {c.label}
              </li>
            ))}
          </ul>

          <p className="mk-ph-label">
            <Camera size={12} /> Before &amp; after
          </p>
          <div className="mk-ph-shots">
            <span className="mk-shot mk-shot-a" />
            <span className="mk-shot mk-shot-b" />
            <span className="mk-shot mk-shot-add">
              <Plus size={14} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── The customer: a booking that prices itself ───────────────────────────── */

const SERVICES = [
  { name: "Standard clean", note: "Every fortnight", on: false },
  { name: "Deep clean", note: "One-off, top to bottom", on: true },
  { name: "Move-out", note: "Landlord ready", on: false },
];

const EXTRAS = ["Inside oven", "Inside fridge", "Interior windows", "Laundry"];

function CustomerSurface() {
  return (
    <div className="mk-app mk-app-book" aria-hidden="true">
      <div className="mk-app-bar">
        <span className="mk-lights">
          <i /><i /><i />
        </span>
        <span className="mk-app-url">
          <b>yourcompany</b>.useawer.com<span className="mk-url-path">/book</span>
        </span>
      </div>

      <div className="mk-book">
        <div className="mk-book-main">
          <p className="mk-book-step">Step 1 of 3</p>
          <h4>What would you like cleaned?</h4>
          <ul className="mk-book-services">
            {SERVICES.map((s) => (
              <li key={s.name} className={s.on ? "mk-on" : ""}>
                <span className="mk-radio">{s.on && <span />}</span>
                <span>
                  <b>{s.name}</b>
                  <em>{s.note}</em>
                </span>
              </li>
            ))}
          </ul>

          <div className="mk-book-counts">
            {[
              { label: "Bedrooms", n: 3 },
              { label: "Bathrooms", n: 2 },
            ].map((c) => (
              <div key={c.label} className="mk-count">
                <span>{c.label}</span>
                <div>
                  <i><Minus size={13} /></i>
                  <b>{c.n}</b>
                  <i><Plus size={13} /></i>
                </div>
              </div>
            ))}
          </div>

          <p className="mk-book-label">Add anything else</p>
          <div className="mk-book-extras">
            {EXTRAS.map((e, i) => (
              <span key={e} className={i === 0 ? "mk-on" : ""}>
                {i === 0 && <Check size={12} strokeWidth={3} />}
                {e}
              </span>
            ))}
          </div>
        </div>

        <aside className="mk-book-side">
          <p className="mk-book-label">Your price</p>
          <ul className="mk-book-lines">
            <li><span>Deep clean · 3 bed, 2 bath</span><b>$248.00</b></li>
            <li><span>Inside oven</span><b>$35.00</b></li>
            <li><span>First-clean discount</span><b className="mk-off">−$28.30</b></li>
          </ul>
          <div className="mk-book-total">
            <span>Total today</span>
            <b>$254.70</b>
          </div>
          <span className="mk-book-go">
            Confirm booking
            <ChevronRight size={16} strokeWidth={2.6} />
          </span>
          <p className="mk-book-fine">Deposit taken now, balance after the clean.</p>
        </aside>
      </div>
    </div>
  );
}

const SURFACES: Record<TabKey, () => ReactElement> = {
  office: OfficeSurface,
  cleaners: CleanerSurface,
  customers: CustomerSurface,
};

export default function Showcase() {
  const [active, setActive] = useState<TabKey>("office");
  const [dir, setDir] = useState(1);
  const listRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLSpanElement>(null);
  const prevRect = useRef<{ x: number; w: number } | null>(null);
  const anim = useRef<Animation | null>(null);
  const baseId = useId();

  /**
   * Move the indicator with transform, and stretch it across the travel.
   *
   * The stretch is the difference between a hand-built indicator and a library
   * default — it peaks at the midpoint of the journey, so the bar reads as one
   * object crossing a distance rather than two states cross-fading. Keyboard
   * arrows skip it and run shorter: those users move fast and repeatedly.
   */
  const moveInk = useCallback((fast = false) => {
    const list = listRef.current;
    const ink = inkRef.current;
    if (!list || !ink) return;
    const on = list.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!on) return;

    const to = { x: on.offsetLeft, w: on.offsetWidth };
    const from = prevRect.current ?? to;
    prevRect.current = to;

    // Cancel first, then write the resting position as an inline style, and only
    // then animate. A `fill: "forwards"` animation outranks inline styles for as
    // long as it exists, so the earlier version could never be re-measured — on
    // a window resize the indicator stayed exactly where it had been put at the
    // old width, which at 320px left it hundreds of pixels off the page.
    anim.current?.cancel();
    // 1px wide and scaled, so the travel maths stays in a single unit.
    ink.style.width = "1px";
    // Follows the row as well as the column: on a narrow screen the tabs wrap,
    // and an indicator pinned to the bottom of the list would sit under the
    // last row while pointing at a tab in the first one.
    ink.style.top = `${on.offsetTop + on.offsetHeight}px`;
    ink.style.transform = `translateX(${to.x}px) scaleX(${to.w})`;

    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (calm || typeof ink.animate !== "function" || from.x === to.x) return;

    const mid = (from.x + to.x) / 2;
    const stretch = Math.max(from.w, to.w) * (fast ? 1 : 1.12);
    // No `fill`: when it ends the element falls back to the inline style above,
    // which is already the destination, so the hand-off is invisible.
    anim.current = ink.animate(
      [
        { transform: `translateX(${from.x}px) scaleX(${from.w})` },
        { transform: `translateX(${mid}px) scaleX(${stretch})`, offset: 0.5 },
        { transform: `translateX(${to.x}px) scaleX(${to.w})` },
      ],
      {
        duration: fast ? 200 : 300,
        // Travelling across the screen, not entering it — an ease-out here
        // looks like the bar got shoved.
        easing: "cubic-bezier(0.65, 0, 0.35, 1)",
      },
    );
  }, []);

  useEffect(() => {
    moveInk();
  }, [active, moveInk]);

  useEffect(() => {
    // Fonts land after first paint and change every tab's width, so measuring
    // once would leave the indicator under the wrong tab on a cold load.
    const settle = () => {
      prevRect.current = null;
      moveInk();
    };
    const ro = new ResizeObserver(settle);
    if (listRef.current) ro.observe(listRef.current);
    document.fonts?.ready.then(settle).catch(() => {});
    return () => ro.disconnect();
  }, [moveInk]);

  /**
   * One rotation, six seconds in, and only if nobody has touched it.
   *
   * Tabs that nobody realises are tabs are just a heading. One move is enough
   * to say "this is interactive"; a carousel that keeps going takes the page
   * away from whoever is reading it, which is why this fires exactly once and
   * cancels the moment anyone interacts.
   */
  const touched = useRef(false);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setTimeout(() => {
      if (touched.current) return;
      setDir(1);
      setActive("cleaners");
    }, 6000);
    return () => window.clearTimeout(t);
  }, []);

  const go = useCallback(
    (key: TabKey) => {
      touched.current = true;
      setDir(TABS.findIndex((t) => t.key === key) > TABS.findIndex((t) => t.key === active) ? 1 : -1);
      setActive(key);
    },
    [active],
  );

  /** Arrow keys move between tabs, which is what a tablist is supposed to do. */
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.key === active);
    const next =
      e.key === "ArrowRight"
        ? i + 1
        : e.key === "ArrowLeft"
          ? i - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? TABS.length - 1
              : -1;
    if (next === -1) return;
    e.preventDefault();
    const t = TABS[(next + TABS.length) % TABS.length];
    go(t.key);
    listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(`${baseId}-${t.key}`)}`)?.focus();
  };

  const current = TABS.find((t) => t.key === active)!;

  return (
    <div className="mk-showcase" style={{ "--dir": dir } as CSSProperties}>
      <div
        className="mk-tabs"
        role="tablist"
        aria-label="What each person sees"
        ref={listRef}
        onKeyDown={onKey}
      >
        <span className="mk-tab-ink" ref={inkRef} aria-hidden="true" />
        {TABS.map((t) => {
          const on = t.key === active;
          return (
            <button
              key={t.key}
              id={`${baseId}-${t.key}`}
              role="tab"
              type="button"
              aria-selected={on}
              aria-controls={`${baseId}-${t.key}-panel`}
              tabIndex={on ? 0 : -1}
              className="mk-tab"
              onClick={() => go(t.key)}
            >
              <t.icon size={17} strokeWidth={2.1} aria-hidden="true" />
              {t.label}
            </button>
          );
        })}
      </div>

      <p className="mk-tab-blurb" key={`${active}-blurb`}>
        {current.blurb}
      </p>

      {/*
        Every panel stays mounted, stacked in one grid cell. Two reasons: the
        outgoing panel needs to still exist to animate away, and the frame's
        height is then the height of the tallest surface no matter which is
        showing — so clicking a tab never resizes the frame and shunts the page
        below it. A showcase that reflows on click is the amateur version, and
        no easing curve rescues it.
      */}
      <div className="mk-show-frame">
        {TABS.map((t) => {
          const on = t.key === active;
          const Surface = SURFACES[t.key];
          return (
            <div
              key={t.key}
              className="mk-show-panel"
              id={`${baseId}-${t.key}-panel`}
              role="tabpanel"
              aria-labelledby={`${baseId}-${t.key}`}
              data-active={on ? "" : undefined}
              inert={!on}
            >
              <Surface />
            </div>
          );
        })}
      </div>
    </div>
  );
}
