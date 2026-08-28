import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Archivo } from "next/font/google";
import type { OrgPlan } from "@prisma/client";
import {
  ArrowRight,
  Banknote,
  BarChart3,
  Boxes,
  CalendarClock,
  Check,
  ClipboardCheck,
  CreditCard,
  Home,
  MessageSquare,
  Smartphone,
  Sparkles,
  Star,
  UserPlus,
  Users,
} from "lucide-react";

import { PLANS, TRIAL_DAYS } from "@/lib/plans";

import Reveal from "./Reveal";
import Showcase from "./Showcase";
import { InventorySurface, PayrollSurface, ReportsSurface } from "./Surfaces";
import "./marketing.css";

/**
 * Awer's front door — what `useawer.com` serves.
 *
 * Lives at /welcome and is rewritten onto `/` for the platform host, so the
 * address bar keeps saying `useawer.com` while the customer portal keeps its
 * own `/` on every company's own subdomain. Two pages cannot both be the root.
 *
 * Nothing here is per-visitor — no session, no database — but the root layout
 * reads headers() to work out which company a request is for, so this renders
 * dynamically like everything else rather than claiming a static export it
 * cannot honour.
 *
 * The prices come from PLANS — the same definition that bills a workspace and
 * caps its cleaners. A pricing page that can drift from what is enforced is a
 * promise nobody kept.
 *
 * ON THE PRODUCT IMAGERY: every screen shown on this page is built as real DOM
 * with invented names, addresses and figures. There are ~90 genuine screenshots
 * of the running app in scripts/shots*, and none of them can be used here: they
 * were captured against the production database and carry real customers' names
 * and real money. DOM also stays sharp on any display and can animate, which a
 * 1x PNG cannot.
 */

/**
 * The display face, loaded only for this route.
 *
 * Montserrat stays the body and interface face because it is the product's
 * face, and a site that looks like a different company than the thing it sells
 * is its own small betrayal. Archivo carries the headlines: flatter and more
 * rectangular than Montserrat's circles, and set wide it reads like signage on
 * a van or the header of a job sheet — the vernacular of the trade this sells
 * to.
 */
const archivo = Archivo({
  subsets: ["latin"],
  variable: "--mk-font-display",
  display: "swap",
  axes: ["wdth"],
});

export const metadata: Metadata = {
  title: "Awer · Software for cleaning companies",
  description:
    "Scheduling, crew, customers, invoicing and payroll for cleaning companies — on your own address. Thirty days free, no card.",
};

const ORDER: OrgPlan[] = ["STARTER", "PROFESSIONAL", "ORGANIZATION"];

/** The day on the hero board. Invented addresses, invented crew. */
const BOARD = [
  { time: "8:00", place: "Willow Crescent", kind: "3-bed deep clean", crew: "Maria · Jo", state: "live" as const, status: "Clocked in" },
  { time: "9:30", place: "Harbour Lofts 4B", kind: "Turnover", crew: "Sam", state: "soon" as const, status: "On the way" },
  { time: "11:00", place: "Fen Street Office", kind: "Weekly contract", crew: "Priya · Alex", state: "next" as const, status: "Scheduled" },
  { time: "13:15", place: "Oakwood Avenue", kind: "Move-out clean", crew: "Maria", state: "next" as const, status: "Scheduled" },
  { time: "15:00", place: "Rosemary Court", kind: "Recurring · fortnightly", crew: "Jo", state: "next" as const, status: "Scheduled" },
];

/**
 * What Awer replaces.
 *
 * This is the page's one honest piece of social proof. It names no customer and
 * invents no number — it names the six things every cleaning company is already
 * paying for and switching between, which is the actual pitch.
 */
const REPLACES = [
  "the shared calendar",
  "the pricing spreadsheet",
  "the crew chat group",
  "the invoicing app",
  "the payroll sheet",
  "the clipboard",
];

/**
 * Every module, colour-coded.
 *
 * The colours are not decoration: each one is that area's colour everywhere it
 * appears on this page, so a reader who has seen the violet card knows what the
 * violet block on the week board is before they read it. `span` marks the two
 * that carry the product — they get the room to prove it.
 */
const MODULES = [
  {
    icon: CalendarClock,
    tone: "teal",
    span: true,
    title: "Scheduling and dispatch",
    body: "The whole week on one screen. Assign a crew, move a job to Thursday, and let recurring work rebook itself without anyone remembering to.",
    points: ["Drag to reschedule", "Recurring, automatically", "Who is where, live"],
  },
  {
    icon: Smartphone,
    tone: "violet",
    span: true,
    title: "A real app for your cleaners",
    body: "They clock in on site, work the checklist and leave before-and-after photos. It opens in a browser and installs to the home screen — nothing to approve, nothing to update.",
    points: ["Clock in and out", "Checklists and photos", "Hours, pay and time off"],
  },
  {
    icon: Home,
    tone: "amber",
    title: "Booking and quotes",
    body: "A booking page priced by your own rules, and quotes for anything that needs a look first.",
  },
  {
    icon: Banknote,
    tone: "green",
    title: "Invoicing and payments",
    body: "Invoices, cards on file and receipts — settled into your own Stripe account, never ours.",
  },
  {
    icon: Users,
    tone: "sky",
    title: "Payroll and payouts",
    body: "The clock-ins that billed the customer are the ones that pay the cleaner. Payday stops being an argument.",
  },
  {
    icon: Boxes,
    tone: "rose",
    title: "Supplies and inventory",
    body: "What each cleaner is carrying, what is running out, and what needs washing.",
  },
  {
    icon: UserPlus,
    tone: "indigo",
    span: true,
    title: "Hiring, built in",
    body: "A careers page, applications and an applicant portal — without a job board.",
  },
  {
    icon: BarChart3,
    tone: "teal",
    span: true,
    title: "Numbers you can act on",
    body: "Revenue, repeat rate and crew performance, reported rather than guessed at.",
  },
];

/**
 * One job, from booked to paid. Numbered because it is a real sequence — this
 * is the order the work happens in, and each stage names the part of Awer that
 * does it. A numbered list that is not a sequence is decoration in a uniform.
 */
const STAGES = [
  { stage: "Booked", title: "The customer picks a slot", body: "Your booking page prices the job by your own rules — rooms, extras, frequency, travel — and takes the deposit." },
  { stage: "Scheduled", title: "It lands on the board", body: "Dispatch a crew, drag it to another day, or leave it alone. Recurring work rebooks itself." },
  { stage: "Worked", title: "The cleaner clocks in on site", body: "They open the job on their phone, work the checklist, and leave before-and-after photos." },
  { stage: "Billed", title: "The invoice writes itself", body: "Hours close the job, the invoice goes out with the photos attached, and the card on file is charged." },
  { stage: "Paid", title: "Those hours become the pay period", body: "The same clock-ins that billed the customer pay the cleaner, and they can see exactly why." },
  { stage: "Followed up", title: "The receipt, the review, the next one", body: "Reminders, on-the-way texts and review requests go out from your address, on their own." },
];

/**
 * Three claims the page makes, each shown rather than asserted.
 *
 * The layout alternates side to side; the MOTION does not. Everything on this
 * page still enters from below, because alternating slide-in directions per
 * section is the most reliable tell of a template.
 */
const DIVES = [
  {
    id: "reports",
    eyebrow: "The numbers",
    title: "Know what you actually made.",
    body: "Revenue, repeat rate, labour cost and the job mix behind them — built from the jobs you already ran, not from a spreadsheet somebody remembered to update.",
    points: [
      "Revenue by week, by month, by crew",
      "Labour as a share of every single job",
      "Which work actually comes back",
    ],
    Surface: ReportsSurface,
    flip: false,
    wash: false,
  },
  {
    id: "payroll",
    eyebrow: "Payday",
    title: "Every hour traced back to a job.",
    body: "The clock-ins that billed the customer are the ones that pay the cleaner. Nobody reconstructs a fortnight from memory, and nobody argues about it afterwards.",
    points: [
      "Hours close when the job closes",
      "Cleaners see what they earned and why",
      "Approve a whole period, not one person at a time",
    ],
    Surface: PayrollSurface,
    flip: true,
    wash: true,
  },
  {
    id: "supplies",
    eyebrow: "Supplies",
    title: "Know what is in every caddy.",
    body: "What each cleaner is carrying, what is running out and what is still in the wash — before a crew turns up at a job without it.",
    points: [
      "Stock levels per kit and per cleaner",
      "Reorder alerts on thresholds you set",
      "The rag-wash cycle, actually counted",
    ],
    Surface: InventorySurface,
    flip: false,
    wash: false,
  },
];

const FAQ = [
  {
    q: "Where does the money go?",
    a: "Straight into your own Stripe account. Every workspace is connected to its own, so a payment your customer makes is settled to you and never passes through anyone else’s balance.",
  },
  {
    q: "Can I bring my existing customers across?",
    a: "Yes. Export your data from BookingKoala and import the file — customers, cleaners and their bookings come across together, so you are not starting from an empty week.",
  },
  {
    q: `What happens after the ${TRIAL_DAYS} days?`,
    a: "You pick a plan. Nothing is charged before you do — there is no card on file to forget about — and nothing is deleted while you make up your mind.",
  },
  {
    q: "Do my cleaners have to install an app?",
    a: "No. It opens in a browser like any other page, and adds itself to the home screen if they want it there. Nothing to approve, nothing to update.",
  },
  {
    q: "What does the address get me?",
    a: "Your own workspace at yourcompany.useawer.com — your prices, your services, your booking rules and your crew. Another company on Awer cannot see any of it, and you cannot see theirs.",
  },
  {
    q: "Can I change the address later?",
    a: "Choose it carefully: the address is fixed once you claim it, because it is what your customers bookmark and your cleaners sign in to. If you genuinely need it moved, talk to us and we will move it for you.",
  },
];

/**
 * The reveal's failsafe.
 *
 * The hidden start state is CSS, so it applies whether or not React ever runs.
 * If Reveal has not announced itself three seconds in — a hydration that failed,
 * a bundle that never arrived — this appends a stylesheet that unhides
 * everything. It adds a node to <head>; it never touches an element React
 * rendered, which is what made an earlier version mismatch on hydration.
 *
 * Decoration must never be the thing standing between a visitor and the page.
 */
const REVEAL_FAILSAFE = `(function(){try{setTimeout(function(){if(window.__mkReveal)return;var s=document.createElement('style');s.textContent='.mk [data-reveal]{opacity:1!important;transform:none!important}';document.head.appendChild(s)},3000)}catch(e){}})()`;

/** The same override for a visitor with JavaScript switched off entirely. */
const REVEAL_NOSCRIPT = ".mk [data-reveal]{opacity:1!important;transform:none!important}";

function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" className="mk-mark">
      <rect width="32" height="32" rx="9" fill="currentColor" />
      <rect x="7.5" y="9" width="17" height="3.1" rx="1.55" fill="#fff" />
      <rect x="7.5" y="14.45" width="12" height="3.1" rx="1.55" fill="#fff" opacity=".72" />
      <rect x="7.5" y="19.9" width="7.5" height="3.1" rx="1.55" fill="#fff" opacity=".46" />
    </svg>
  );
}

export default function WelcomePage() {
  return (
    <div className={`mk ${archivo.variable}`}>
      <noscript>
        <style dangerouslySetInnerHTML={{ __html: REVEAL_NOSCRIPT }} />
      </noscript>
      <script dangerouslySetInnerHTML={{ __html: REVEAL_FAILSAFE }} />
      <Reveal />

      <a className="mk-skip" href="#main">
        Skip to content
      </a>

      <Link href="/get-started" className="mk-ann">
        <span className="mk-ann-tag">New</span>
        {/* On a phone the long clause wrapped to three lines and left the dash
            stranded on one of its own. The offer is the part that matters. */}
        <span className="mk-ann-long">Awer is open to cleaning companies everywhere &mdash;</span>
        <b>{TRIAL_DAYS} days free, no card</b>
        <ArrowRight size={14} strokeWidth={2.6} aria-hidden="true" />
      </Link>

      <header className="mk-nav">
        <div className="mk-wrap mk-nav-in">
          <Link href="/" className="mk-logo" aria-label="Awer home">
            <Mark />
            Awer
          </Link>
          <nav className="mk-nav-links" aria-label="Sections">
            <a href="#showcase">Product</a>
            <a href="#inside">What&rsquo;s inside</a>
            <a href="#how">How it works</a>
            <a href="#pricing">Pricing</a>
          </nav>
          <div className="mk-nav-actions">
            <Link href="/sign-in" className="mk-btn mk-btn-plain mk-hide-sm">
              Sign in
            </Link>
            <Link href="/get-started" className="mk-btn mk-btn-primary">
              Start free
            </Link>
          </div>
        </div>
      </header>

      <main id="main">
        <div className="mk-nav-sentinel" aria-hidden="true" />
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section className="mk-hero">
          {/* Two soft colour fields behind the fold. Painted with radial
              gradients rather than an image, so they cost nothing to load and
              scale to any width without going soft. */}
          <div className="mk-aurora" aria-hidden="true">
            <span className="mk-aurora-a" />
            <span className="mk-aurora-b" />
          </div>

          <div className="mk-wrap mk-hero-grid">
            <div className="mk-hero-copy">
              <p className="mk-pill">
                <Sparkles size={13} strokeWidth={2.4} aria-hidden="true" />
                Software for cleaning companies
              </p>
              <h1 className="mk-h1">
                Every job. Every cleaner. Every dollar.
                <em className="mk-em"> One board.</em>
              </h1>
              <p className="mk-lead">
                Awer runs the scheduling, the crew, the customers, the invoicing and the
                payroll for a cleaning company — at an address that belongs to you.
              </p>
              <div className="mk-hero-cta">
                <Link href="/get-started" className="mk-btn mk-btn-primary mk-btn-lg">
                  Start free for {TRIAL_DAYS} days
                  <ArrowRight size={17} strokeWidth={2.4} aria-hidden="true" />
                </Link>
                <a href="#showcase" className="mk-btn mk-btn-ghost mk-btn-lg">
                  See it working
                </a>
              </div>
              <ul className="mk-trust">
                {[`${TRIAL_DAYS} days free`, "No card to start", "Set up in an afternoon"].map((t) => (
                  <li key={t}>
                    <Check size={15} strokeWidth={3} aria-hidden="true" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>

            {/* The day, on the board. Sample data, plainly a picture. */}
            <div className="mk-hero-stage">
              <div className="mk-board-tilt">
              <div className="mk-board" aria-hidden="true">
                <div className="mk-board-chrome">
                  <span className="mk-lights">
                    <i /><i /><i />
                  </span>
                  <span className="mk-url">
                    <b>yourcompany</b>.useawer.com
                  </span>
                </div>

                <div className="mk-board-head">
                  <div>
                    <strong>Tuesday</strong>
                    <span>12 August</span>
                  </div>
                  <span className="mk-board-count">5 jobs · 4 cleaners</span>
                </div>

                <ol className="mk-rows">
                  {BOARD.map((row, i) => (
                    <li key={row.place} className="mk-row" style={{ "--i": i } as CSSProperties}>
                      <span className="mk-row-time">{row.time}</span>
                      <span className="mk-row-main">
                        <strong>{row.place}</strong>
                        <span>{row.kind}</span>
                      </span>
                      <span className="mk-row-crew">{row.crew}</span>
                      {row.state === "soon" ? (
                        <span className="mk-chip-swap">
                          <span className="mk-chip mk-chip-soon mk-chip-was">{row.status}</span>
                          <span className="mk-chip mk-chip-live mk-chip-now">
                            <i className="mk-pulse" />
                            Clocked in
                          </span>
                        </span>
                      ) : (
                        <span className={`mk-chip mk-chip-${row.state}`}>
                          {row.state === "live" && <i className="mk-pulse" />}
                          {row.status}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>

                <div className="mk-board-foot">
                  <span><b>18.5</b> hours logged</span>
                  <span><b>$1,340</b> invoiced</span>
                  <span><b>2</b> photo sets to review</span>
                </div>
              </div>
              </div>

              {/* Three things the board does while nobody is watching it. */}
              <span className="mk-float mk-float-1" style={{ "--i": 0 } as CSSProperties} aria-hidden="true">
                <i className="mk-float-i mk-tone-green"><Banknote size={15} /></i>
                <b>$340 invoiced</b>
                <em>Harbour Lofts · paid</em>
              </span>
              <span className="mk-float mk-float-2" style={{ "--i": 1 } as CSSProperties} aria-hidden="true">
                <i className="mk-float-i mk-tone-violet"><ClipboardCheck size={15} /></i>
                <b>Maria clocked in</b>
                <em>Willow Crescent · 7:58</em>
              </span>
            </div>
          </div>
        </section>

        {/* ── What it replaces ─────────────────────────────────────────────── */}
        <section className="mk-replaces">
          <div className="mk-wrap" data-reveal>
            <p className="mk-replaces-label">One system, in place of</p>
            <ul className="mk-replaces-row" data-reveal-group data-reveal-cols="6">
              {REPLACES.map((r, i) => (
                <li key={r}>
                  <s>{r}</s>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── The product itself ───────────────────────────────────────────── */}
        <section className="mk-section" id="showcase">
          <div className="mk-wrap">
            <div className="mk-section-head mk-center" data-reveal-group>
              <p className="mk-eyebrow">
                <span className="mk-dot" aria-hidden="true" />
                See it working
              </p>
              <h2 className="mk-h2">Three people. Three screens. One system.</h2>
              <p className="mk-lead">
                Your office, your cleaners and your customers all arrive at the same address
                and land where they belong — each seeing only what is theirs to see.
              </p>
            </div>
            <div data-reveal>
              <Showcase />
            </div>
          </div>
        </section>

        {/* ── Everything inside ───────────────────────────────────────────── */}
        <section className="mk-section mk-section-wash" id="inside">
          <div className="mk-wrap">
            <div className="mk-section-head" data-reveal-group>
              <p className="mk-eyebrow">
                <span className="mk-dot" aria-hidden="true" />
                What&rsquo;s inside
              </p>
              <h2 className="mk-h2">Everything a cleaning company runs on.</h2>
              <p className="mk-lead">
                Not a calendar with extras bolted on. Every part of the business, in one
                place, sharing one set of facts.
              </p>
            </div>
            <ul className="mk-bento" data-reveal-group data-reveal-cols="4">
              {MODULES.map((m, i) => (
                <li
                  key={m.title}
                  className={`mk-mod mk-tone-${m.tone}${m.span ? " mk-mod-wide" : ""}`}
                >
                  <span className="mk-mod-icon" aria-hidden="true">
                    <m.icon size={19} strokeWidth={2.1} />
                  </span>
                  <h3 className="mk-h3">{m.title}</h3>
                  <p>{m.body}</p>
                  {m.points && (
                    <ul className="mk-mod-points">
                      {m.points.map((p) => (
                        <li key={p}>
                          <Check size={14} strokeWidth={3} aria-hidden="true" />
                          {p}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── Three claims, shown rather than asserted ─────────────────────── */}
        {DIVES.map((d) => (
          <section
            key={d.id}
            id={d.id}
            className={`mk-dive${d.wash ? " mk-section-wash" : ""}`}
          >
            <div className={`mk-wrap mk-dive-grid${d.flip ? " mk-dive-flip" : ""}`}>
              <div className="mk-dive-copy" data-reveal-group>
                <p className="mk-eyebrow">
                  <span className="mk-dot" aria-hidden="true" />
                  {d.eyebrow}
                </p>
                <h2 className="mk-h2">{d.title}</h2>
                <p className="mk-lead">{d.body}</p>
                <ul className="mk-checks">
                  {d.points.map((p) => (
                    <li key={p}>
                      <Check size={15} strokeWidth={2.8} aria-hidden="true" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {/* No data-reveal here: the shot is driven by a scroll-linked
                  view() animation instead, and two systems writing one
                  element's transform means one of them silently wins. */}
              <div className="mk-dive-shot">
                <d.Surface />
              </div>
            </div>
          </section>
        ))}

        {/* ── One job, end to end ─────────────────────────────────────────── */}
        <section className="mk-section" id="how">
          <div className="mk-wrap mk-how-grid">
            <div className="mk-section-head mk-how-head" data-reveal-group>
              <p className="mk-eyebrow">
                <span className="mk-dot" aria-hidden="true" />
                How the work moves
              </p>
              <h2 className="mk-h2">One job, from booked to paid.</h2>
              <p className="mk-lead">
                Most cleaning companies run on a calendar, a spreadsheet, a chat group and
                an invoicing app that cannot see each other. Awer is one system, so the job
                a customer booked is the job a cleaner works and the job you bill.
              </p>
            </div>

            <ol className="mk-rail" data-reveal-group>
              {STAGES.map((s, i) => (
                <li key={s.stage} className="mk-stage">
                  <div className="mk-stage-node" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <div className="mk-stage-body">
                    <p className="mk-stage-label">{s.stage}</p>
                    <h3 className="mk-h3">{s.title}</h3>
                    <p>{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Where it came from ──────────────────────────────────────────── */}
        <section className="mk-origin">
          <div className="mk-wrap mk-origin-grid">
            <div className="mk-origin-shot" data-reveal>
              <Image
                src="/employee-login.png"
                alt="A cleaner in uniform holding a stocked caddy in a customer's living room"
                width={941}
                height={1672}
                sizes="(min-width: 900px) 440px, 90vw"
                className="mk-origin-img"
              />
            </div>
            <div className="mk-origin-copy" data-reveal>
              <p className="mk-eyebrow">
                <span className="mk-dot" aria-hidden="true" />
                Where it came from
              </p>
              <h2 className="mk-h2">Built inside a working cleaning company.</h2>
              <p className="mk-lead">
                Awer was not designed on a whiteboard. Every screen in it exists because a
                real crew needed it on a real Tuesday — a cleaner standing in a hallway
                with no signal, an office trying to work out who was where, an owner
                reconciling a pay period at eleven at night.
              </p>
              <p className="mk-lead">
                That is why the parts fit together. They were never separate.
              </p>
            </div>
          </div>
        </section>

        {/* ── Pricing ─────────────────────────────────────────────────────── */}
        <section className="mk-section mk-section-wash" id="pricing">
          <div className="mk-wrap">
            <div className="mk-section-head mk-center" data-reveal-group>
              <p className="mk-eyebrow">
                <span className="mk-dot" aria-hidden="true" />
                Pricing
              </p>
              <h2 className="mk-h2">Priced by the size of your crew.</h2>
              <p className="mk-lead">
                Every plan starts with {TRIAL_DAYS} days free and no card. Move up when you
                hire, not when you are asked to.
              </p>
            </div>
            <ul className="mk-plans" data-reveal-group data-reveal-cols="3">
              {ORDER.map((key, i) => {
                const p = PLANS[key];
                const featured = key === "PROFESSIONAL";
                const cap =
                  p.maxCleaners == null ? "Unlimited cleaners" : `Up to ${p.maxCleaners} cleaners`;
                // The cap is already the line under the price, and PLANS opens
                // every highlight list with it. Printing both put "Up to 5
                // cleaners" on the card twice.
                const highlights = p.highlights.filter(
                  (h) => h.toLowerCase() !== cap.toLowerCase(),
                );
                return (
                  <li
                    key={key}
                    className={`mk-plan${featured ? " mk-plan-featured" : ""}`}
                  >
                    <div className="mk-plan-top">
                      <h3 className="mk-plan-name">{p.label}</h3>
                      {/* Marked by a label as well as a colour — colour alone
                          says nothing to anyone who cannot see it. */}
                      {featured && <span className="mk-plan-tag">Most chosen</span>}
                    </div>
                    <p className="mk-price">
                      {p.monthlyUsd == null ? (
                        <b className="mk-price-quote">Let&rsquo;s talk</b>
                      ) : (
                        <>
                          <b>${p.monthlyUsd}</b>
                          <span>per month</span>
                        </>
                      )}
                    </p>
                    <p className="mk-plan-cap">{cap}</p>
                    <Link
                      href={
                        p.selfServe
                          ? `/get-started?plan=${key.toLowerCase()}`
                          : "/get-started/organization"
                      }
                      className={`mk-btn ${featured ? "mk-btn-primary" : "mk-btn-ghost"}`}
                    >
                      {p.selfServe ? `Start ${p.label}` : "Talk to us"}
                    </Link>
                    <p className="mk-plan-note">
                      {p.selfServe
                        ? `${TRIAL_DAYS} days free · no card`
                        : "Onboarding and migration included"}
                    </p>
                    <ul className="mk-checks">
                      {highlights.map((h) => (
                        <li key={h}>
                          <Check size={15} strokeWidth={2.8} aria-hidden="true" />
                          <span>{h}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
            <p className="mk-plans-foot" data-reveal>
              <CreditCard size={15} strokeWidth={2.1} aria-hidden="true" />
              Prices in USD. Payments from your customers settle into your own Stripe
              account, not ours.
            </p>
          </div>
        </section>

        {/* ── Questions ───────────────────────────────────────────────────── */}
        <section className="mk-section" id="questions">
          <div className="mk-wrap mk-faq-grid">
            <div className="mk-section-head mk-faq-head" data-reveal-group>
              <p className="mk-eyebrow">
                <span className="mk-dot" aria-hidden="true" />
                Before you start
              </p>
              <h2 className="mk-h2">The questions we get asked.</h2>
              <p className="mk-lead">
                If yours is not here, ask us — a straight answer is cheaper for both of us
                than a month of finding out.
              </p>
            </div>
            <div className="mk-faq" data-reveal>
              {FAQ.map((item) => (
                <details key={item.q} className="mk-q">
                  <summary>
                    {item.q}
                    <span className="mk-q-mark" aria-hidden="true" />
                  </summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── The close ───────────────────────────────────────────────────── */}
        <section className="mk-cta">
          <div className="mk-aurora mk-aurora-dark" aria-hidden="true">
            <span className="mk-aurora-a" />
            <span className="mk-aurora-b" />
          </div>
          <div className="mk-wrap mk-cta-in">
            <p className="mk-eyebrow">
              <span className="mk-dot" aria-hidden="true" />
              Ready when you are
            </p>
            <h2 className="mk-h2">Claim your address.</h2>
            <p className="mk-lead">
              {TRIAL_DAYS} days free, no card, and your workspace is live the moment you
              finish signing up.
            </p>
            <div className="mk-cta-row">
              <Link href="/get-started" className="mk-btn mk-btn-primary mk-btn-lg">
                Start free
                <ArrowRight size={17} strokeWidth={2.4} aria-hidden="true" />
              </Link>
              <Link href="/get-started/organization" className="mk-btn mk-btn-ghost mk-btn-lg">
                Talk to us
              </Link>
            </div>
            <p className="mk-cta-fine">
              <MessageSquare size={14} strokeWidth={2.2} aria-hidden="true" />
              Larger team, or moving from another system? We will do the migration with you.
            </p>
          </div>
        </section>
      </main>

      <div className="mk-bar" data-mk-bar>
        <div className="mk-bar-in">
          <span>
            <b>{TRIAL_DAYS} days free</b>
            <em>No card to start</em>
          </span>
          <Link href="/get-started" className="mk-btn mk-btn-primary">
            Start free
          </Link>
        </div>
      </div>

      <footer className="mk-foot">
        <div className="mk-wrap mk-foot-grid">
          <div className="mk-foot-brand">
            <Link href="/" className="mk-logo" aria-label="Awer home">
              <Mark size={26} />
              Awer
            </Link>
            <p>Scheduling, crew, customers, invoicing and payroll for cleaning companies.</p>
          </div>
          <nav aria-label="Product">
            <p className="mk-foot-label">Product</p>
            <a href="#showcase">See it working</a>
            <a href="#inside">What&rsquo;s inside</a>
            <a href="#how">How it works</a>
            <a href="#pricing">Pricing</a>
          </nav>
          <nav aria-label="Get started">
            <p className="mk-foot-label">Get started</p>
            <Link href="/get-started">Start free</Link>
            <Link href="/get-started/organization">Larger teams</Link>
            <a href="#questions">Questions</a>
          </nav>
          <nav aria-label="Sign in">
            <p className="mk-foot-label">Sign in</p>
            <Link href="/sign-in">Office</Link>
            <Link href="/cleanos/login">Cleaners</Link>
            <Link href="/login">Customers</Link>
          </nav>
        </div>
        <div className="mk-wrap mk-foot-base">
          <span>&copy; {new Date().getFullYear()} Awer</span>
          <span>Made for people who clean for a living.</span>
        </div>
      </footer>
    </div>
  );
}
