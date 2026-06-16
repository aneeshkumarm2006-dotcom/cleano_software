import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { getSetting } from "@/lib/settings";
import { Calendar, Users, Package, Zap, Camera, ListChecks, MapPin, DollarSign } from "lucide-react";
import Link from "next/link";
import BackButton from "../BackButton";
import ClockInButton from "../ClockInButton";
import ClockOutButton from "../ClockOutButton";
import CancelShiftButton from "../CancelShiftButton";
import WhyThisPriceLink from "../WhyThisPriceLink";
import PhotoGallery from "./PhotoGallery";
import JobChecklistPanel from "./JobChecklistPanel";
import MapLinks from "./MapLinksClient";

type PageProps = {
  params: Promise<{ jobId: string }>;
};

function jobTypeLabel(type: string | null) {
  if (!type) return null;
  switch (type) {
    case "R": return "Residential cleaning";
    case "C": return "Commercial cleaning";
    case "PC": return "Post-construction cleaning";
    case "F": return "Follow-up cleaning";
    case "move-in-out": return "Move-in / move-out cleaning";
    default: return type;
  }
}

function jobTypeSlug(type: string | null) {
  if (!type) return null;
  switch (type) {
    case "R": return "Residential";
    case "C": return "Commercial";
    case "PC": return "Post-Construction";
    case "F": return "Follow-up";
    default: return type.toUpperCase();
  }
}

export default async function JobDetailPage({ params }: PageProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const { jobId } = await params;

  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
      employee: true,
      cleaners: true,
      addOns: true,
      productUsage: { include: { product: true } },
      client: { select: { phone: true, email: true } },
    },
  });

  if (!job) redirect("/my-jobs");

  const isEmployee = job.employeeId === session.user.id;
  const isCleaner = job.cleaners.some((c) => c.id === session.user.id);
  if (!isEmployee && !isCleaner) redirect("/my-jobs");

  const showCustomerPhone = await getSetting("provider.showCustomerPhone");

  const employeeProductsRaw = await db.employeeProduct.findMany({
    where: { employeeId: session.user.id },
    include: { product: { include: { inventoryRule: true } } },
  });
  const employeeProducts = employeeProductsRaw.map((ep) => ({
    id: ep.id,
    productId: ep.productId,
    quantity: ep.quantity,
    product: {
      id: ep.product.id,
      name: ep.product.name,
      unit: ep.product.unit,
      category: ep.product.category,
      inventoryRule: ep.product.inventoryRule
        ? {
            usagePerJob: ep.product.inventoryRule.usagePerJob,
            refillThreshold: ep.product.inventoryRule.refillThreshold,
          }
        : null,
    },
  }));

  const jobWithClock = job as any;
  const duration =
    jobWithClock.clockInTime && jobWithClock.clockOutTime
      ? Math.round(
          (new Date(jobWithClock.clockOutTime).getTime() -
            new Date(jobWithClock.clockInTime).getTime()) /
            1000 / 60
        )
      : null;

  const canClockIn = !jobWithClock.clockInTime && job.status !== "COMPLETED";
  const canClockOut = jobWithClock.clockInTime && !jobWithClock.clockOutTime;
  const canCancelShift =
    !jobWithClock.clockInTime &&
    !["COMPLETED", "CANCELLED", "IN_PROGRESS", "PAID"].includes(job.status);
  const instantPayoutEligible =
    job.status === "COMPLETED" && job.paymentReceived === true && isEmployee;

  const statusSlug = job.status.toLowerCase().replace("_", "");

  const addOnsArr = (job as any).addOns ?? [];

  return (
    <div className="cl-jd-shell">
      {/* Back */}
      <BackButton />

      {/* Hero */}
      <header className="cl-jd-hero">
        {job.location && (
          <>
            <div className="loc">
              <MapPin size={14} />
              {job.location}
            </div>
            <MapLinks address={job.location} />
          </>
        )}
        <h1>{job.clientName}</h1>
        {jobTypeLabel(job.jobType) && (
          <div className="job-type">{jobTypeLabel(job.jobType)}</div>
        )}
        <div className="pills">
          <span className={`cl-pill ${statusSlug}`}>{job.status.replace("_", " ")}</span>
          {job.jobType && (
            <span className="cl-pill">{jobTypeSlug(job.jobType)}</span>
          )}
          <span className="cl-pill">JOB #{job.id.slice(-6).toUpperCase()}</span>
        </div>

        <div className="cl-jd-quick">
          {job.jobDate && (
            <div className="cl-jd-quick-tile">
              <div className="lbl">Date</div>
              <div className="val">
                {new Date(job.jobDate).toLocaleDateString("en-US", {
                  weekday: "short", month: "short", day: "numeric",
                })}
              </div>
            </div>
          )}
          {job.startTime && (
            <div className="cl-jd-quick-tile">
              <div className="lbl">Start time</div>
              <div className="val">
                {new Date(job.startTime).toLocaleTimeString("en-US", {
                  hour: "numeric", minute: "2-digit", hour12: true,
                })}
              </div>
            </div>
          )}
          {(job.endTime || job.startTime) && (
            <div className="cl-jd-quick-tile">
              <div className="lbl">Est. duration</div>
              <div className="val">
                {job.endTime && job.startTime
                  ? (() => {
                      const mins = Math.round(
                        (new Date(job.endTime).getTime() - new Date(job.startTime).getTime()) / 60000
                      );
                      return `${(mins / 60).toFixed(1)}h`;
                    })()
                  : "—"}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Instant payout banner */}
      {instantPayoutEligible && (
        <div className="cl-jd-payout-banner">
          <span className="cl-jd-payout-icon">
            <Zap size={22} />
          </span>
          <div className="cl-jd-payout-meta">
            <strong>Instant Payout Eligible</strong>
            <span>
              Payment received.{" "}
              {job.employeePay != null
                ? `Request a withdrawal of $${job.employeePay.toFixed(2)} from My Pay.`
                : "Request a withdrawal from My Pay."}
            </span>
          </div>
          <Link href="/my-pay" className="cl-jd-payout-btn">
            <DollarSign size={15} />
            Withdraw
          </Link>
        </div>
      )}

      {/* Time tracking */}
      {(canClockIn || canClockOut) && (
        <div className="cl-jd-track">
          <span className="cl-jd-track-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
          </span>
          <div className="cl-jd-track-meta">
            <h3>Time tracking</h3>
            <p>
              {canClockIn
                ? "Clock in when you arrive on site to start your shift."
                : "Clock out when you finish the job."}
            </p>
          </div>
          <div className="cl-jd-track-action">
            {canClockIn && (
              <ClockInButton jobId={job.id} jobStartTime={job.startTime ?? null} />
            )}
            {canClockOut && (
              <ClockOutButton jobId={job.id} employeeProducts={employeeProducts} />
            )}
          </div>
        </div>
      )}

      {/* Can't make it */}
      {canCancelShift && (
        <div className="cl-jd-cancel">
          <span className="cl-jd-cancel-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </span>
          <div className="cl-jd-cancel-meta">
            <strong>{"Can't make it?"}</strong>
            <span>Cancelling less than 24 hours before the shift incurs a $20 fee and a 1-star penalty.</span>
          </div>
          <CancelShiftButton jobId={job.id} shiftStartTime={job.startTime} />
        </div>
      )}

      {/* Clocked-in time summary */}
      {jobWithClock.clockInTime && (
        <>
          <h2 className="cl-jd-section-title">Time <em>summary.</em></h2>
          <div className="cl-jd-time-summary">
            <div className="cl-jd-time-tile">
              <div className="lbl">Clocked in</div>
              <div className="val">
                {new Date(jobWithClock.clockInTime).toLocaleString("en-US", {
                  month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
                })}
              </div>
            </div>
            {jobWithClock.clockOutTime && (
              <div className="cl-jd-time-tile">
                <div className="lbl">Clocked out</div>
                <div className="val">
                  {new Date(jobWithClock.clockOutTime).toLocaleString("en-US", {
                    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
                  })}
                </div>
              </div>
            )}
            {duration && (
              <div className="cl-jd-time-tile">
                <div className="lbl">Total duration</div>
                <div className="val">{Math.floor(duration / 60)}h {duration % 60}m</div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Job details */}
      <h2 className="cl-jd-section-title">Job <em>details.</em></h2>
      <div className="cl-jd-row">
        {/* Date & time card */}
        <div className="cl-jd-card">
          <div className="cl-jd-card-head">
            <span className="icon-bubble">
              <Calendar size={20} />
            </span>
            <h3>Date &amp; time</h3>
          </div>
          <dl className="cl-jd-dl">
            {job.jobDate && (
              <div className="cl-jd-dl-row featured">
                <dt>Job date</dt>
                <dd>
                  {new Date(job.jobDate).toLocaleDateString("en-US", {
                    weekday: "short", month: "long", day: "numeric", year: "numeric",
                  })}
                </dd>
              </div>
            )}
            {job.startTime && (
              <div className="cl-jd-dl-row">
                <dt>Start time</dt>
                <dd>
                  {new Date(job.startTime).toLocaleTimeString("en-US", {
                    hour: "numeric", minute: "2-digit", hour12: true,
                  })}
                </dd>
              </div>
            )}
            {job.endTime && (
              <div className="cl-jd-dl-row">
                <dt>End time</dt>
                <dd>
                  {new Date(job.endTime).toLocaleTimeString("en-US", {
                    hour: "numeric", minute: "2-digit", hour12: true,
                  })}
                </dd>
              </div>
            )}
            {job.employeePay != null && isEmployee && (
              <div className="cl-jd-dl-row">
                <dt>Est. pay</dt>
                <dd>${job.employeePay.toFixed(2)}</dd>
              </div>
            )}
          </dl>
          {job.employeePay != null && isEmployee && (
            <div style={{ marginTop: -4 }}>
              <WhyThisPriceLink jobId={job.id} />
            </div>
          )}
        </div>

        {/* Team card */}
        <div className="cl-jd-card">
          <div className="cl-jd-card-head">
            <span className="icon-bubble">
              <Users size={20} />
            </span>
            <h3>Team</h3>
            <span className="head-extra">
              {job.cleaners.length + (job.employee ? 1 : 0)} member{job.cleaners.length + (job.employee ? 1 : 0) === 1 ? "" : "s"}
            </span>
          </div>
          <div>
            <div className="cl-jd-team-row">
              <span style={{ fontSize: 12, color: "var(--primary-50)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Lead</span>
              {job.employee ? (
                <div style={{ marginLeft: "auto", textAlign: "right" }}>
                  <div className="name">{job.employee.name}</div>
                </div>
              ) : (
                <span className="cl-pill" style={{ marginLeft: "auto", background: "var(--cream)", color: "var(--primary-50)" }}>Unassigned</span>
              )}
            </div>
            {job.cleaners.map((c: any) => (
              <div key={c.id} className="cl-jd-team-row">
                <div
                  style={{
                    width: 36, height: 36, borderRadius: "50%",
                    background: "var(--primary-10)", color: "var(--primary)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, fontWeight: 700, flexShrink: 0,
                  }}
                >
                  {c.name?.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="name">{c.name}</div>
                  <div className="role">{c.id === session.user.id ? "You · Cleaner" : "Cleaner"}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Contact Client */}
      {showCustomerPhone && (job.client?.phone || job.client?.email) && (
        <>
          <h2 className="cl-jd-section-title">Contact <em>client.</em></h2>
          <div className="cl-jd-card" style={{ marginBottom: 0 }}>
            <div className="cl-jd-card-head">
              <span className="icon-bubble">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.15 11.9 19.79 19.79 0 0 1 1.07 3.27 2 2 0 0 1 3.05 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 8.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 16l.92.92z" />
                </svg>
              </span>
              <h3>Client contact</h3>
            </div>
            <dl className="cl-jd-dl">
              {job.client?.phone && (
                <div className="cl-jd-dl-row featured">
                  <dt>Phone</dt>
                  <dd>
                    <a href={`tel:${job.client.phone}`} style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 600 }}>
                      {job.client.phone}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
            <p style={{ fontSize: 11, color: "var(--primary-40)", margin: "8px 0 0", lineHeight: 1.5 }}>
              Use this to let the client know if you&apos;re running late or have a quick question about the job.
            </p>
          </div>
        </>
      )}

      {/* Home details */}
      {(job.bedCount != null || job.bathCount != null || job.halfBathCount != null || addOnsArr.length > 0) && (
        <>
          <h2 className="cl-jd-section-title">Home <em>details.</em></h2>
          <div className="cl-jd-row">
            {(job.bedCount != null || job.bathCount != null || job.halfBathCount != null || job.squareFootage) && (
              <div className="cl-jd-card">
                <div className="cl-jd-card-head">
                  <span className="icon-bubble">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
                    </svg>
                  </span>
                  <h3>Property size</h3>
                </div>
                <dl className="cl-jd-dl">
                  {job.bedCount != null && (
                    <div className="cl-jd-dl-row"><dt>Bedrooms</dt><dd>{job.bedCount}</dd></div>
                  )}
                  {job.bathCount != null && (
                    <div className="cl-jd-dl-row"><dt>Full bathrooms</dt><dd>{job.bathCount}</dd></div>
                  )}
                  {job.halfBathCount != null && job.halfBathCount > 0 && (
                    <div className="cl-jd-dl-row"><dt>Half bathrooms</dt><dd>{job.halfBathCount}</dd></div>
                  )}
                  {job.squareFootage != null && job.squareFootage > 0 && (
                    <div className="cl-jd-dl-row featured"><dt>Square footage</dt><dd>{job.squareFootage} sq ft</dd></div>
                  )}
                </dl>
              </div>
            )}

            <div className="cl-jd-card">
              <div className="cl-jd-card-head">
                <span className="icon-bubble">
                  <Package size={20} />
                </span>
                <h3>Add-ons</h3>
                <span className="head-extra">
                  {addOnsArr.length} extra{addOnsArr.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="cl-jd-addons">
                {addOnsArr.length === 0 ? (
                  <span style={{ fontSize: 13, color: "var(--primary-50)", fontStyle: "italic" }}>No add-ons for this job.</span>
                ) : addOnsArr.map((a: any) => (
                  <div key={a.id} className="cl-jd-addon-chip">
                    <span className="dot" />
                    {a.name}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Notes */}
      <h2 className="cl-jd-section-title">Notes</h2>
      <div className={`cl-jd-notes${!job.notes ? " empty" : ""}`}>
        {job.notes || "No special instructions from the client. The team will be in touch if anything changes."}
      </div>

      {/* Checklist */}
      {["SCHEDULED", "IN_PROGRESS", "COMPLETED", "PAID"].includes(job.status) && (
        <>
          <h2 className="cl-jd-section-title" id="checklist" style={{ scrollMarginTop: 80 }}>
            <ListChecks size={22} />
            Checklist
          </h2>
          <div className="cl-jd-checklist-wrap">
            <JobChecklistPanel jobId={job.id} canEdit={job.status !== "PAID"} />
          </div>
        </>
      )}

      {/* Photos */}
      {["IN_PROGRESS", "COMPLETED", "PAID"].includes(job.status) && (
        <>
          <h2 className="cl-jd-section-title" id="photos" style={{ scrollMarginTop: 80 }}>
            <Camera size={22} />
            Photos
          </h2>
          {(() => {
            const afterPhotosAllowed =
              job.afterPhotoConsent || job.afterPhotoOverrideAt !== null;
            const overridden = !job.afterPhotoConsent && job.afterPhotoOverrideAt !== null;
            return (
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "12px 14px",
                  borderRadius: 12,
                  marginBottom: 14,
                  fontSize: 13.5,
                  lineHeight: 1.5,
                  border: `1px solid ${afterPhotosAllowed ? "#6ee7b7" : "#fca5a5"}`,
                  background: afterPhotosAllowed ? "#ecfdf5" : "#fef2f2",
                  color: afterPhotosAllowed ? "#065f46" : "#991b1b",
                }}>
                <Camera size={16} style={{ flex: "0 0 auto", marginTop: 1 }} />
                <span>
                  {afterPhotosAllowed ? (
                    <>
                      <strong>After-photos allowed.</strong>{" "}
                      {overridden
                        ? "Enabled by an admin override for this job."
                        : "The customer consented to after-photos for quality control."}
                    </>
                  ) : (
                    <>
                      <strong>After-photos not permitted.</strong> The customer did not
                      consent for this job. Please don&apos;t take after-photos unless an
                      admin enables it.
                    </>
                  )}
                </span>
              </div>
            );
          })()}
          <div className="cl-jd-photos-wrap">
            <PhotoGallery
              jobId={job.id}
              canUpload={job.status !== "PAID"}
              afterPhotosAllowed={
                job.afterPhotoConsent || job.afterPhotoOverrideAt !== null
              }
            />
          </div>
        </>
      )}

      {/* Product usage */}
      {job.productUsage.length > 0 && (
        <>
          <h2 className="cl-jd-section-title">Products <em>used.</em></h2>
          <div className="cl-jd-card" style={{ marginBottom: 28 }}>
            <div className="cl-jd-card-head">
              <span className="icon-bubble"><Package size={20} /></span>
              <h3>Product usage</h3>
              <span className="head-extra">{job.productUsage.length} item{job.productUsage.length === 1 ? "" : "s"}</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--primary-10)" }}>
                    <th style={{ padding: "8px 0", textAlign: "left", color: "var(--primary-60)", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em" }}>Product</th>
                    <th style={{ padding: "8px 0", textAlign: "left", color: "var(--primary-60)", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em" }}>Qty</th>
                    {jobWithClock.clockOutTime && (
                      <>
                        <th style={{ padding: "8px 0", textAlign: "left", color: "var(--primary-60)", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em" }}>Before</th>
                        <th style={{ padding: "8px 0", textAlign: "left", color: "var(--primary-60)", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em" }}>After</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {job.productUsage.map((u: any) => (
                    <tr key={u.id} style={{ borderBottom: "1px solid var(--primary-5)" }}>
                      <td style={{ padding: "10px 0", color: "var(--ink)", fontWeight: 500 }}>{u.product.name}</td>
                      <td style={{ padding: "10px 0", color: "var(--ink)" }}>{u.quantity} {u.product.unit}</td>
                      {jobWithClock.clockOutTime && (
                        <>
                          <td style={{ padding: "10px 0", color: "var(--primary-60)" }}>{u.inventoryBefore != null ? `${u.inventoryBefore} ${u.product.unit}` : "—"}</td>
                          <td style={{ padding: "10px 0", color: "var(--primary-60)" }}>{u.inventoryAfter != null ? `${u.inventoryAfter} ${u.product.unit}` : "—"}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
