import type { CSSProperties } from "react";
import type { Metadata } from "next";
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
  LayoutDashboard,
  MessageSquare,
  Smartphone,
  UserPlus,
  Users,
} from "lucide-react";

import { PLANS, TRIAL_DAYS } from "@/lib/plans";

import Reveal from "./Reveal";
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
 * The page is built around one idea: a cleaning company's day is a board, and
 * Awer is the board everyone reads. So the hero shows a day rather than
 * describing one, and the features are not nine equal cards — they are one job
 * followed from booked to paid, which is what "one system" actually means.
 */

/**
 * The display face, loaded only for this route.
 *
 * Montserrat stays the body and interface face because it is the product's
 * face, and a site that looks like a different company than the thing it sells
 * is its own small betrayal. Archivo carries the headlines: flatter and more
 * rectangular than Montserrat's circles, and set slightly wide it reads like
 * signage on a van or the header of a job sheet — the vernacular of the trade
 * this is sold to.
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

/**
 * The day on the hero board.
 *
 * Invented addresses and invented crew — it is a picture of the product, the
 * way a car advertisement photographs a road nobody drove on. Nothing here
 * claims to be a customer, a logo or a number anyone can be held to.
 */
const BOARD = [
  {
    time: "8:00",
    place: "Willow Crescent",
    kind: "3-bed deep clean",
    crew: "Maria · Jo",
    state: "live" as const,
    status: "Clocked in",
  },
  {
    time: "9:30",
    place: "Harbour Lofts 4B",
    kind: "Turnover",
    crew: "Sam",
    state: "soon" as const,
    status: "On the way",
  },
  {
    time: "11:00",
    place: "Fen Street Office",
    kind: "Weekly contract",
    crew: "Priya · Alex",
    state: "next" as const,
    status: "Scheduled",
  },
  {
    time: "13:15",
    place: "Oakwood Avenue",
    kind: "Move-out clean",
    crew: "Maria",
    state: "next" as const,
    status: "Scheduled",
  },
  {
    time: "15:00",
    place: "Rosemary Court",
    kind: "Recurring · fortnightly",
    crew: "Jo",
    state: "next" as const,
    status: "Scheduled",
  },
];

/**
 * One job, from booked to paid.
 *
 * Numbered because it is a real sequence — this is the order the work actually
 * happens in, and each stage names the part of Awer that does it. A numbered
 * list that is not a sequence is just decoration wearing a uniform.
 */
const STAGES = [
  {
    icon: Home,
    stage: "Booked",
    title: "The customer picks a slot",
    body: "Your booking page prices the job by your own rules — rooms, extras, frequency, travel — and takes the deposit. Quotes go out the same way for anything that needs a look first.",
  },
  {
    icon: CalendarClock,
    stage: "Scheduled",
    title: "It lands on the board",
    body: "Dispatch a crew, drag it to another day, or leave it alone — recurring work rebooks itself, and the whole week is one screen instead of four.",
  },
  {
    icon: ClipboardCheck,
    stage: "Worked",
    title: "The cleaner clocks in on site",
    body: "They open the job on their phone, work the checklist, and leave before-and-after photos. You see it happen without ringing anyone.",
  },
  {
    icon: Banknote,
    stage: "Billed",
    title: "The invoice writes itself",
    body: "Hours close the job, the invoice goes out with the photos attached, and the card on file is charged. No second system, no re-typing.",
  },
  {
    icon: Users,
    stage: "Paid",
    title: "Those hours become the pay period",
    body: "The same clock-ins that billed the customer pay the cleaner. They can see what they earned and which jobs it came from, so payday stops being an argument.",
  },
  {
    icon: MessageSquare,
    stage: "Followed up",
    title: "The receipt, the review, the next one",
    body: "Reminders, on-the-way texts, receipts and review requests all go out from your address, on their own, whether or not you remembered.",
  },
];

const ALSO = [
  {
    icon: Boxes,
    title: "Supplies and inventory",
    body: "What each cleaner is carrying, what is running out, and what needs washing.",
  },
  {
    icon: UserPlus,
    title: "Hiring, built in",
    body: "A careers page, applications and an applicant portal — without a job board.",
  },
  {
    icon: BarChart3,
    title: "Numbers you can act on",
    body: "Revenue, repeat rate and crew performance, reported rather than guessed at.",
  },
];

const DOORS = [
  {
    icon: LayoutDashboard,
    who: "The office",
    path: "/sign-in",
    body: "The board, the clients, the money and the crew.",
    points: ["Today, this week, this month", "Invoices, quotes and payroll", "Who is where, right now"],
  },
  {
    icon: Smartphone,
    who: "Your cleaners",
    path: "/cleanos/login",
    body: "Only their own shifts \u2014 never anybody else\u2019s.",
    points: ["Clock in and out on site", "Checklists and job photos", "Hours, pay and time off"],
  },
  {
    icon: Home,
    who: "Your customers",
    path: "/login",
    body: "Book, reschedule, pay and rate, without phoning you.",
    points: ["Book in their own time", "Card on file and receipts", "Rate the clean afterwards"],
  },
];

/**
 * Answers to the things a cleaning company owner actually asks before signing
 * up. Written from what the product does, not from what would sell best.
 */
const FAQ = [
  {
    q: "Where does the money go?",
    a: "Straight into your own Stripe account. Every workspace is connected to its own, so a payment your customer makes is settled to you and never passes through anyone else\u2019s balance.",
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
 * rendered, which is what made the earlier version mismatch on hydration.
 *
 * Decoration must never be the thing standing between a visitor and the page.
 */
const REVEAL_FAILSAFE = `(function(){try{setTimeout(function(){if(window.__mkReveal)return;var s=document.createElement('style');s.textContent='.mk [data-reveal]{opacity:1!important;transform:none!important}';document.head.appendChild(s)},3000)}catch(e){}})()`;

/** The same override for a visitor with JavaScript switched off entirely. */
const REVEAL_NOSCRIPT = ".mk [data-reveal]{opacity:1!important;transform:none!important}";

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

      <header className="mk-nav">
        <div className="mk-wrap mk-nav-in">
          <Link href="/" className="mk-logo" aria-label="Awer home">
            <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" className="mk-mark">
              <rect width="32" height="32" rx="9" fill="currentColor" />
              <rect x="7.5" y="9" width="17" height="3.1" rx="1.55" fill="#fff" />
              <rect x="7.5" y="14.45" width="12" height="3.1" rx="1.55" fill="#fff" opacity=".72" />
              <rect x="7.5" y="19.9" width="7.5" height="3.1" rx="1.55" fill="#fff" opacity=".46" />
            </svg>
            Awer
          </Link>
          <nav className="mk-nav-links" aria-label="Sections">
            <a href="#how">How it works</a>
            <a href="#pricing">Pricing</a>
            <a href="#questions">Questions</a>
          </nav>
          <div className="mk-nav-actions">
            <Link href="/sign-in" className="mk-btn mk-btn-plain mk-hide-xs">
              Sign in
            </Link>
            <Link href="/get-started" className="mk-btn mk-btn-primary">
              Start free
            </Link>
          </div>
        </div>
      </header>

      <main id="main">
        {/* Hero. The thesis is the board: a day you can read at a glance. */}
        <section className="mk-hero">
          <div className="mk-wrap mk-hero-grid">
            <div className="mk-hero-copy">
              <p className="mk-eyebrow">
                <span className="mk-dot" aria-hidden="true" />
                Software for cleaning companies
              </p>
              <h1 className="mk-h1">
                The whole company on <em className="mk-em">one board.</em>
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
                <a href="#pricing" className="mk-btn mk-btn-ghost mk-btn-lg">
                  See pricing
                </a>
              </div>
              <ul className="mk-trust">
                {[`${TRIAL_DAYS} days free`, "No card to start", "Your own address"].map((t) => (
                  <li key={t}>
                    <Check size={15} strokeWidth={3} aria-hidden="true" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>

            {/* The board itself. Sample data, plainly a picture of the product. */}
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
                  <li
                    key={row.place}
                    className="mk-row"
                    style={{ "--i": i } as CSSProperties}
                  >
                    <span className="mk-row-time">{row.time}</span>
                    <span className="mk-row-main">
                      <strong>{row.place}</strong>
                      <span>{row.kind}</span>
                    </span>
                    <span className="mk-row-crew">{row.crew}</span>
                    <span className={`mk-chip mk-chip-${row.state}`}>
                      {row.state === "live" && <i className="mk-pulse" />}
                      {row.status}
                    </span>
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
        </section>

        {/* One job, end to end. The spine of the whole product. */}
        <section className="mk-section mk-section-wash" id="how">
          <div className="mk-wrap mk-how-grid">
            <div className="mk-section-head mk-how-head" data-reveal>
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

            <ol className="mk-rail">
              {STAGES.map((s, i) => (
                <li key={s.stage} className="mk-stage" data-reveal data-reveal-delay={i * 60}>
                  <div className="mk-stage-node" aria-hidden="true">
                    <s.icon size={18} strokeWidth={2.1} />
                  </div>
                  <div className="mk-stage-body">
                    <p className="mk-stage-label">
                      <span className="mk-stage-num">{String(i + 1).padStart(2, "0")}</span>
                      {s.stage}
                    </p>
                    <h3 className="mk-h3">{s.title}</h3>
                    <p>{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mk-also" data-reveal>
              <p className="mk-also-label">And the rest of it</p>
              <ul className="mk-also-grid">
                {ALSO.map((a) => (
                  <li key={a.title}>
                    <span className="mk-also-icon" aria-hidden="true">
                      <a.icon size={17} strokeWidth={2.1} />
                    </span>
                    <strong>{a.title}</strong>
                    <span>{a.body}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Three doors — the thing that makes it your company, not ours. */}
        <section className="mk-section">
          <div className="mk-wrap">
            <div className="mk-section-head" data-reveal>
              <p className="mk-eyebrow">
                <span className="mk-dot" aria-hidden="true" />
                Everyone gets a way in
              </p>
              <h2 className="mk-h2">Three doors, one address.</h2>
              <p className="mk-lead">
                Your office, your cleaners and your customers all arrive at the same address
                and land where they belong — each seeing only what is theirs to see.
              </p>
            </div>
            <ul className="mk-doors">
              {DOORS.map((d, i) => (
                <li key={d.who} className="mk-door" data-reveal data-reveal-delay={i * 70}>
                  <span className="mk-door-icon" aria-hidden="true">
                    <d.icon size={19} strokeWidth={2} />
                  </span>
                  <h3 className="mk-h3">{d.who}</h3>
                  <p className="mk-door-path">
                    <span>yourcompany.useawer.com</span>
                    <b>{d.path}</b>
                  </p>
                  <p className="mk-door-body">{d.body}</p>
                  <ul className="mk-checks">
                    {d.points.map((p) => (
                      <li key={p}>
                        <Check size={15} strokeWidth={2.8} aria-hidden="true" />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Pricing, from the same definition that enforces the limits. */}
        <section className="mk-section mk-section-wash" id="pricing">
          <div className="mk-wrap">
            <div className="mk-section-head" data-reveal>
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
            <ul className="mk-plans">
              {ORDER.map((key, i) => {
                const p = PLANS[key];
                const featured = key === "PROFESSIONAL";
                const cap =
                  p.maxCleaners == null
                    ? "Unlimited cleaners"
                    : `Up to ${p.maxCleaners} cleaners`;
                // The cleaner cap is already the line under the price, and
                // PLANS opens every highlight list with it. Printing both put
                // "Up to 5 cleaners" on the card twice.
                const highlights = p.highlights.filter(
                  (h) => h.toLowerCase() !== cap.toLowerCase(),
                );
                return (
                  <li
                    key={key}
                    className={`mk-plan${featured ? " mk-plan-featured" : ""}`}
                    data-reveal
                    data-reveal-delay={i * 70}
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
                    <ul className="mk-checks">
                      {highlights.map((h) => (
                        <li key={h}>
                          <Check size={15} strokeWidth={2.8} aria-hidden="true" />
                          <span>{h}</span>
                        </li>
                      ))}
                    </ul>
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

        {/* The objections, answered in the open. */}
        <section className="mk-section" id="questions">
          <div className="mk-wrap mk-faq-grid">
            <div className="mk-section-head mk-faq-head" data-reveal>
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

        <section className="mk-section mk-cta">
          <div className="mk-wrap">
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
          </div>
        </section>
      </main>

      <footer className="mk-foot">
        <div className="mk-wrap mk-foot-in">
          <span className="mk-foot-brand">
            <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true" className="mk-mark">
              <rect width="32" height="32" rx="9" fill="currentColor" />
              <rect x="7.5" y="9" width="17" height="3.1" rx="1.55" fill="#fff" />
              <rect x="7.5" y="14.45" width="12" height="3.1" rx="1.55" fill="#fff" opacity=".72" />
              <rect x="7.5" y="19.9" width="7.5" height="3.1" rx="1.55" fill="#fff" opacity=".46" />
            </svg>
            &copy; {new Date().getFullYear()} Awer
          </span>
          <nav className="mk-foot-links" aria-label="Footer">
            <Link href="/get-started">Start free</Link>
            <Link href="/get-started/organization">Larger teams</Link>
            <Link href="/sign-in">Sign in</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
