"use client";

import { useState } from "react";
import { Compass } from "lucide-react";

import Tour, { type TourStop } from "./Tour";
import { markTourSeen } from "@/app/admin/actions/markTourSeen";

/**
 * Owns whether the tour is open, and is the one place it can be started from.
 *
 * The button is always here, for two reasons. A tour that only ever appears
 * unbidden on somebody's first morning is a tour nobody can ever look at again
 * — including the person who was hired in March and inherited a workspace
 * somebody else set up. And an automatic tour that cannot be summoned back
 * punishes the reflex of closing an unexpected overlay.
 */

/** The stop that is only offered while the setup card is actually on screen. */
const CHECKLIST_STOP: TourStop = {
  target: "setupChecklist",
  title: "Start with this list",
  body:
    "It reads your real settings, so it always tells you what is genuinely still missing — and it disappears by itself once you have finished. The one marked “blocks bookings” is the one to do first: until you list the areas you cover, the booking form turns every address away.",
};

const STOPS: TourStop[] = [
  {
    title: "Welcome to Awer",
    body:
      "This is your whole operation in one place — bookings, the schedule, your cleaners, and the money. Two minutes here and you will know where everything lives. You can leave at any point with Escape, and pick it up again from the button on your dashboard.",
  },
  {
    target: "jobs",
    title: "Jobs is where the work lives",
    body:
      "Every clean you have ever booked, scheduled or finished. Cleaners clock in and out against these, photos and checklists attach to them, and this is where you mark one as paid.",
  },
  {
    target: "calendar",
    title: "Calendar shows who is where",
    body:
      "The same jobs laid out by day and by cleaner. Use it to spot the gaps before you take the next booking, and to move a job by dragging it rather than opening it.",
  },
  {
    target: "clients",
    title: "Clients are the people you clean for",
    body:
      "Addresses, contact details, card on file and every past visit. Jobs hang off a client, so adding someone here once saves retyping their address on every future booking.",
  },
  {
    target: "webBookings",
    title: "Web Bookings come in on their own",
    body:
      "Anything a customer books from your public page lands here first, priced by your own rates. This is the page to watch once your prices and service areas are set.",
  },
  {
    target: "employees",
    title: "Employees is your team",
    body:
      "Add a cleaner here and they get their own login, their own app, and their own pay. Their rate, availability and supplies are all set from their profile.",
  },
  {
    target: "finances",
    title: "Finances is the money",
    body:
      "What you have collected, what is still owed, and what you owe your cleaners. It reads the same jobs you see everywhere else, so it never needs its own bookkeeping.",
  },
  {
    target: "settings",
    title: "Settings is where you configure it",
    body:
      "Your prices, sales tax, the areas you cover, the services you sell and your Stripe key all live here — everything on the setup list points into it. Worth an unhurried visit before your first real booking.",
  },
  {
    title: "That is the tour",
    body:
      "Nothing here can be broken by clicking around, so have a look. When you are ready to set the business up properly, work down the list on your dashboard — and this tour is always on the button beside it.",
  },
];

export default function TourLauncher({
  /** True on a workspace that still has setup outstanding — see the dashboard. */
  autoStart,
  /** False once the setup card has gone, so the tour stops citing a card that is not there. */
  hasChecklist,
  /** Whether this PERSON has already been shown it — User.tourSeenAt, read on the server. */
  seen,
}: {
  autoStart: boolean;
  hasChecklist: boolean;
  seen: boolean;
}) {
  // Safe in the initial state now that it arrives as a prop. The previous
  // version read localStorage, which does not exist on the server, so it had to
  // wait for an effect and the tour appeared a frame late; and being per-browser
  // it showed the same owner the tour again on their phone.
  const [open, setOpen] = useState(autoStart && !seen);

  function close() {
    setOpen(false);
    // Fire and forget: the overlay must close instantly, and the action already
    // swallows its own failures. Losing this write costs one extra offer.
    void markTourSeen();
  }

  const stops = hasChecklist
    ? [STOPS[0], CHECKLIST_STOP, ...STOPS.slice(1)]
    : STOPS;

  return (
    <>
      <button type="button" className="tour-launch" onClick={() => setOpen(true)}>
        <Compass size={14} />
        Take a tour
      </button>
      {open && <Tour stops={stops} onClose={close} />}
    </>
  );
}
