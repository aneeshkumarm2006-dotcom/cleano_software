import type { Metadata } from "next";
import Link from "next/link";
import type { OrgPlan } from "@prisma/client";
import {
  ArrowRight,
  Banknote,
  BarChart3,
  Boxes,
  CalendarClock,
  Check,
  ClipboardCheck,
  Home,
  MessageSquare,
  Repeat,
  Users,
} from "lucide-react";

import { PLANS, TRIAL_DAYS } from "@/lib/plans";

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
 */

export const metadata: Metadata = {
  title: "Awer · Software for cleaning companies",
  description:
    "Scheduling, crew, customers, invoicing and payroll for cleaning companies — on your own address. Thirty days free, no card.",
};

const ORDER: OrgPlan[] = ["STARTER", "PROFESSIONAL", "ORGANIZATION"];

const DOORS = [
  {
    icon: BarChart3,
    who: "The office",
    path: "/sign-in",
    what: "Jobs, clients, money, crew",
  },
  {
    icon: ClipboardCheck,
    who: "Your cleaners",
    path: "/cleanos/login",
    what: "Today's jobs, clock in, photos",
  },
  {
    icon: Home,
    who: "Your customers",
    path: "/login",
    what: "Book, reschedule, pay, rate",
  },
];

const FEATURES = [
  {
    icon: CalendarClock,
    title: "Scheduling that holds",
    body: "Dispatch a crew, see the whole week, and let recurring work book itself.",
  },
  {
    icon: ClipboardCheck,
    title: "A real app for cleaners",
    body: "Clock in on site, work the checklist, leave before-and-after photos.",
  },
  {
    icon: Home,
    title: "Customers book themselves",
    body: "A booking page priced by your own rules, and a portal to manage it after.",
  },
  {
    icon: Banknote,
    title: "Invoicing and payments",
    body: "Quotes, invoices, cards on file and receipts, without a second system.",
  },
  {
    icon: Users,
    title: "Payroll and payouts",
    body: "Hours become pay periods. Cleaners see what they earned and why.",
  },
  {
    icon: Boxes,
    title: "Supplies and inventory",
    body: "What each cleaner is carrying, what is running out, what needs washing.",
  },
  {
    icon: MessageSquare,
    title: "Email and text, automatic",
    body: "Reminders, on-the-way notices and review requests, from your address.",
  },
  {
    icon: Repeat,
    title: "Hiring, built in",
    body: "A careers page, applications and an applicant portal, without a job board.",
  },
  {
    icon: BarChart3,
    title: "Numbers you can act on",
    body: "Revenue, repeat rate, crew performance — reported, not guessed at.",
  },
];

const STEPS = [
  {
    title: "Pick your address",
    body: "Choose the name your team and your customers will use. It is yours the moment you claim it.",
  },
  {
    title: "Add your crew and your prices",
    body: "Set what you charge, invite your cleaners, and turn on the booking page.",
  },
  {
    title: "Take the first booking",
    body: `Thirty days free, no card. If it is not right for you, nothing to cancel.`,
  },
];

function Feature({ icon: Icon, title, body }: (typeof FEATURES)[number]) {
  return (
    <li className="mk-card">
      <div className="mk-card-icon" aria-hidden="true">
        <Icon size={19} strokeWidth={2} />
      </div>
      <h3 className="mk-h3">{title}</h3>
      <p>{body}</p>
    </li>
  );
}

export default function WelcomePage() {
  return (
    <div className="mk">
      <a className="mk-skip" href="#main">
        Skip to content
      </a>

      <header className="mk-nav">
        <div className="mk-wrap mk-nav-in">
          <Link href="/" className="mk-logo" aria-label="Awer home">
            <Home size={22} strokeWidth={2.2} aria-hidden="true" />
            Awer
          </Link>
          <nav className="mk-nav-actions" aria-label="Account">
            <Link href="/sign-in" className="mk-btn mk-btn-plain mk-hide-xs">
              Sign in
            </Link>
            <Link href="/get-started" className="mk-btn mk-btn-primary">
              Start free
            </Link>
          </nav>
        </div>
      </header>

      <main id="main">
        {/* Hero. The thesis is the address: one workspace, three doors. */}
        <section className="mk-hero">
          <div className="mk-wrap mk-hero-grid">
            <div>
              <p className="mk-eyebrow">
                <span className="mk-dot" aria-hidden="true" />
                For cleaning companies
              </p>
              <h1 className="mk-h1">
                Every job, every cleaner, <em className="mk-em">one place.</em>
              </h1>
              <p className="mk-lead">
                Awer runs the scheduling, the crew, the customers, the invoicing and the
                payroll for a cleaning company — on an address that belongs to you.
              </p>
              <div className="mk-hero-cta">
                <Link href="/get-started" className="mk-btn mk-btn-primary mk-btn-lg">
                  Start free for {TRIAL_DAYS} days
                  <ArrowRight size={17} strokeWidth={2.4} aria-hidden="true" />
                </Link>
                <Link href="#pricing" className="mk-btn mk-btn-ghost mk-btn-lg">
                  See pricing
                </Link>
              </div>
              <p className="mk-hero-note">No card. Set up in an afternoon.</p>
            </div>

            <div className="mk-panel">
              <div className="mk-panel-bar">
                <span className="mk-panel-lights" aria-hidden="true">
                  <i /><i /><i />
                </span>
                <span className="mk-url">
                  <b>yourcompany</b>.useawer.com
                </span>
              </div>
              <ul className="mk-doors">
                {DOORS.map((d) => (
                  <li key={d.who} className="mk-door">
                    <span className="mk-door-icon" aria-hidden="true">
                      <d.icon size={19} strokeWidth={2} />
                    </span>
                    <span className="mk-door-body">
                      <strong>{d.who}</strong>
                      <span>
                        {d.path} — {d.what}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* What runs on it. */}
        <section className="mk-section mk-section-wash">
          <div className="mk-wrap">
            <div className="mk-section-head">
              <p className="mk-eyebrow">
                <span className="mk-dot" aria-hidden="true" />
                What runs on it
              </p>
              <h2 className="mk-h2">The whole company, not one corner of it.</h2>
              <p className="mk-lead">
                Most cleaning companies run on a calendar, a spreadsheet, a chat group and
                an invoicing app that none of the others can see. Awer is one system, so
                the job a customer booked is the job a cleaner works and the job you bill.
              </p>
            </div>
            <ul className="mk-grid">
              {FEATURES.map((f) => (
                <Feature key={f.title} {...f} />
              ))}
            </ul>
          </div>
        </section>

        {/* Pricing, from the same definition that enforces the limits. */}
        <section className="mk-section" id="pricing">
          <div className="mk-wrap">
            <div className="mk-section-head">
              <p className="mk-eyebrow">
                <span className="mk-dot" aria-hidden="true" />
                Pricing
              </p>
              <h2 className="mk-h2">Priced by the size of your crew.</h2>
              <p className="mk-lead">
                Every plan starts with {TRIAL_DAYS} days free and no card. Move up when
                you hire, not when you are asked to.
              </p>
            </div>
            <ul className="mk-grid">
              {ORDER.map((key) => {
                const p = PLANS[key];
                const featured = key === "PROFESSIONAL";
                return (
                  <li
                    key={key}
                    className={`mk-plan${featured ? " mk-plan-featured" : ""}`}
                  >
                    {featured && <span className="mk-plan-tag">Most chosen</span>}
                    <h3 className="mk-plan-name">{p.label}</h3>
                    <p className="mk-price">
                      {p.monthlyUsd == null ? (
                        <b>Let&rsquo;s talk</b>
                      ) : (
                        <>
                          <b>${p.monthlyUsd}</b>
                          <span>per month</span>
                        </>
                      )}
                    </p>
                    <p className="mk-plan-cap">
                      {p.maxCleaners == null
                        ? "Unlimited cleaners"
                        : `Up to ${p.maxCleaners} cleaners`}
                    </p>
                    <ul className="mk-checks">
                      {p.highlights.map((h) => (
                        <li key={h}>
                          <Check size={16} strokeWidth={2.6} aria-hidden="true" />
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
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* How it starts — a genuine sequence, which is why it is numbered. */}
        <section className="mk-section mk-section-wash">
          <div className="mk-wrap">
            <div className="mk-section-head">
              <p className="mk-eyebrow">
                <span className="mk-dot" aria-hidden="true" />
                Getting started
              </p>
              <h2 className="mk-h2">Three steps, one afternoon.</h2>
            </div>
            <ol className="mk-steps">
              {STEPS.map((s) => (
                <li key={s.title} className="mk-step">
                  <div>
                    <h3 className="mk-h3">{s.title}</h3>
                    <p>{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
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
          <span>&copy; {new Date().getFullYear()} Awer</span>
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
