"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, DoorOpen, MapPin, Phone, RotateCw } from "lucide-react";

import { readJobLifeline, readOfficePhone, type JobLifeline } from "./JobLifeline";

/**
 * Route error boundary for /cleaners/my-jobs/[jobId].
 *
 * Why this file exists: this page had no boundary at all, so anything it threw
 * — the `jobIssue.findMany` the status doc flags, a serialization fault, or
 * most commonly `getCurrentOrg()` failing to reach the database (P1001 /
 * P1017 in the dev log) — fell through to Next's bare "Application error: a
 * server-side exception has occurred". That screen is blank, and it lands in
 * front of a cleaner who is standing at a customer's door with the address on
 * the other side of it.
 *
 * THIS BOUNDARY HIDES NOTHING. The page still throws, the server still logs
 * the stack, `digest` still ties the two together, and the cause of the
 * incident this was written for was a database outage, not a bug this covers
 * up. What changes is what the cleaner is left holding.
 *
 * It fails USEFUL: the address and the office's number come from the strip
 * <JobLifeline> wrote to localStorage the last time this page rendered (see the
 * file for what is deliberately not in it). No fetch, no database — the
 * boundary has to work in exactly the conditions that broke the page.
 */
export default function JobDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useParams<{ jobId: string }>();
  const jobId = typeof params?.jobId === "string" ? params.jobId : null;

  // localStorage is read after mount, never during render: this screen must not
  // be the place where a hydration mismatch starts.
  const [lifeline, setLifeline] = useState<JobLifeline | null>(null);
  const [officePhone, setOfficePhone] = useState<string | null>(null);

  useEffect(() => {
    const cached = jobId ? readJobLifeline(jobId) : null;
    setLifeline(cached);
    // Fall back to the number any other job left behind, so a job that has
    // never opened successfully still gives the cleaner somebody to call.
    setOfficePhone(cached?.officePhone ?? readOfficePhone());
  }, [jobId]);

  useEffect(() => {
    // Logged with the same shape as the settings boundary: `digest` is the only
    // handle support has on an error whose message the cleaner never sees.
    console.error("[cleaner job detail] route error", error);
  }, [error]);

  return (
    <div className="cl-jd-shell">
      {/* The address first and biggest, in the hero the working page uses —
          the one thing on this screen a cleaner may be reading in a lobby. */}
      <header className="cl-jd-hero">
        {lifeline?.address ? (
          <>
            <div className="loc">
              <MapPin size={14} />
              {lifeline.address}
            </div>
            {lifeline.aptLabel && (
              <div className="cl-jd-apt">
                <DoorOpen size={15} />
                <span>{lifeline.aptLabel}</span>
              </div>
            )}
          </>
        ) : (
          <div className="loc">
            <MapPin size={14} />
            Address unavailable offline — call the office below.
          </div>
        )}
        <h1>This job didn&apos;t load</h1>
        {lifeline?.when && <div className="job-type">{lifeline.when}</div>}
        <div className="pills">
          <span className="cl-pill">
            {lifeline
              ? "Showing the last details saved on this device"
              : "No saved details on this device"}
          </span>
        </div>
      </header>

      <div className="cl-jd-card">
        <div className="cl-jd-card-head">
          <span className="icon-bubble">
            <AlertTriangle className="w-5 h-5" strokeWidth={1.9} />
          </span>
          <div>
            <h3>Something went wrong loading this job</h3>
            <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--primary-70)" }}>
              Your clock-in, photos and reports are safe — nothing was lost. Keep
              working the job and try again in a moment.
            </p>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {officePhone && (
            /* First and styled as the primary action: if the page is broken and
               the cleaner is on site, talking to a human beats every button
               under it. */
            <a
              className="cl-jd-otw"
              /* Letters are KEPT, unlike the customer portal's `[^\d+]` strip:
                 the shipped default for this setting is "(514) 555-CLEAN", and
                 that strip turns it into "514555" — a tel: link that dials six
                 digits and reaches nobody. Dialers map vanity letters; visual
                 separators are the only thing that has to go. */
              href={`tel:${officePhone.replace(/[^\d+*#A-Za-z]/g, "")}`}
              style={{ background: "var(--primary)", color: "#fff", borderColor: "var(--primary)" }}>
              <Phone size={16} strokeWidth={2} />
              Call the office · {officePhone}
            </a>
          )}
          <button type="button" className="cl-jd-otw" onClick={() => reset()}>
            <RotateCw size={16} strokeWidth={2} />
            Try again
          </button>
          <Link className="cl-jd-otw" href="/cleaners/my-jobs">
            Back to My jobs
          </Link>
        </div>

        {error.digest && (
          <p style={{ fontSize: 12, color: "var(--primary-70)", margin: 0 }}>
            If it keeps happening, quote this reference to the office:{" "}
            <code>{error.digest}</code>
          </p>
        )}
      </div>
    </div>
  );
}
