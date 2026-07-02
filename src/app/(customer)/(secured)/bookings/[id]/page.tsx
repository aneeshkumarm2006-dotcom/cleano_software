import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { db } from "@/db";
import { getSettings } from "@/lib/settings";
import Link from "next/link";
import { ArrowLeft, Download, MapPin, Users, CreditCard } from "lucide-react";
import { StatusBadge, DateBadge } from "@/components/customer/atoms";
import { Banner } from "@/components/customer/Field";
import RequestActions from "./RequestActions";
import JobChatThread from "@/components/JobChatThread";

function formatPrice(n: number | null | undefined) {
  return `$${(n ?? 0).toFixed(2)}`;
}

// Curated, customer-safe labels for the portal activity feed. We never render
// raw log descriptions (they can contain internal operational notes).
const ACTIVITY_LABELS: Record<string, string> = {
  CREATED: "Booking created",
  STATUS_CHANGED: "Status updated",
  PAYMENT_RECEIVED: "Payment received",
  INVOICE_SENT: "Invoice sent",
  CLOCKED_IN: "Cleaner arrived",
  CLOCKED_OUT: "Cleaner finished",
};
function formatTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}
function formatLongDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const email = session.user.email?.toLowerCase();
  const client = email
    ? await db.client.findFirst({ where: { email } })
    : null;
  if (!client) redirect("/");

  const job = await db.job.findUnique({
    where: { id },
    include: {
      cleaners: { select: { id: true, name: true } },
      addOns: { select: { name: true, price: true } },
      logs: {
        // Customer-safe lifecycle events only. Internal free-text logs
        // (NOTE_ADDED, UPDATED, PRODUCT_USED, cleaner churn) are excluded so
        // operational notes — e.g. fee-collection instructions — never leak.
        where: {
          action: {
            in: [
              "CREATED",
              "STATUS_CHANGED",
              "PAYMENT_RECEIVED",
              "INVOICE_SENT",
              "CLOCKED_IN",
              "CLOCKED_OUT",
            ],
          },
        },
        select: {
          id: true,
          action: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });

  if (!job || job.clientId !== client.id) notFound();

  const isUpcoming = new Date(job.startTime) >= new Date();
  const {
    "policy.cancellationFeeUsd": cancellationFeeUsd,
    "policy.cancellationFeeWindowHours": cancellationWindowHours,
    "customer.cancellationReasons": cancellationReasons,
    "general.businessEmail": businessEmail,
    "general.businessPhone": businessPhone,
    "customer.providerRatingThreshold": providerRatingThreshold,
  } = await getSettings([
    "policy.cancellationFeeUsd",
    "policy.cancellationFeeWindowHours",
    "customer.cancellationReasons",
    "general.businessEmail",
    "general.businessPhone",
    "customer.providerRatingThreshold",
  ]);

  // #66: show an assigned cleaner's average rating to the customer only when it
  // meets the configured threshold (and they have at least 3 ratings).
  const cleanerIds = job.cleaners.map((c) => c.id);
  const ratingAgg = cleanerIds.length
    ? await db.employeeRating.groupBy({
        by: ["employeeId"],
        where: { employeeId: { in: cleanerIds } },
        _avg: { rating: true },
        _count: { rating: true },
      })
    : [];
  const cleanerRating = new Map<string, number>();
  for (const r of ratingAgg) {
    const avg = r._avg.rating ?? 0;
    if (r._count.rating >= 3 && avg >= providerRatingThreshold) {
      cleanerRating.set(r.employeeId, Math.round(avg * 10) / 10);
    }
  }
  const isCompletedOrPaid = job.status === "COMPLETED" || job.status === "PAID";
  const hasCancelRequest = !!job.cancellationRequestedAt;
  const hasRescheduleRequest = !!job.rescheduleRequestedAt;
  const hasRequest = hasCancelRequest || hasRescheduleRequest;

  return (
    <>
      <header style={{ marginBottom: 32 }}>
        <Link
          href="/bookings"
          className="cl-link-muted"
          style={{
            fontSize: 13,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 16,
          }}>
          <ArrowLeft size={14} /> Back to bookings
        </Link>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}>
          <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
            <DateBadge iso={job.startTime.toISOString()} />
            <div className="cl-stack-8">
              <p className="cl-eyebrow">Job #{job.jobNumber}</p>
              <h1
                className="cl-display"
                style={{ fontSize: "clamp(32px, 4vw, 44px)" }}>
                {formatLongDate(job.startTime.toISOString())}
              </h1>
              <p className="cl-subtitle" style={{ marginTop: 0, fontSize: 15 }}>
                {formatTime(job.startTime.toISOString())}
                {job.isFlexible ? " · Flexible (we'll confirm the time)" : ""}
              </p>
            </div>
          </div>
          <StatusBadge status={job.status} />
        </div>
      </header>

      {hasRequest ? (
        <div style={{ marginBottom: 24 }}>
          <Banner kind="amber">
            {hasCancelRequest
              ? "Cancellation requested — awaiting confirmation from our team."
              : "Reschedule requested — we'll be in touch."}
            {hasCancelRequest && job.cancellationReason
              ? ` Reason: ${job.cancellationReason}.`
              : ""}
          </Banner>
        </div>
      ) : null}

      {job.status === "CANCELLED" && job.cancellationReason ? (
        <div style={{ marginBottom: 24 }}>
          <Banner kind="amber">
            This booking was cancelled. Reason: {job.cancellationReason}.
          </Banner>
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 360px",
          gap: 24,
          alignItems: "flex-start",
        }}
        className="cl-booking-detail-grid">
        {/* Left column */}
        <div className="cl-stack-24">
          <section className="cl-tile cl-tile-pad-lg">
            <h2 className="cl-title-md" style={{ marginBottom: 18 }}>
              Service details
            </h2>
            <dl className="cl-dlist">
              <DetailRow dt="Type" dd={job.jobType ?? "Standard cleaning"} />
              <DetailRow
                dt="Address"
                dd={job.location ?? "—"}
              />
              <DetailRow
                dt="Property"
                dd={`${job.bedCount ?? "?"} bed · ${job.bathCount ?? "?"} bath${
                  job.halfBathCount ? ` + ${job.halfBathCount} half` : ""
                }${
                  job.squareFootage ? ` · ${job.squareFootage} sq ft` : ""
                }`}
              />
              <DetailRow
                dt="Cleaners"
                dd={
                  job.cleaners.length
                    ? job.cleaners
                        .map((c) => {
                          const r = cleanerRating.get(c.id);
                          return r ? `${c.name} (${r.toFixed(1)}★)` : c.name;
                        })
                        .join(", ")
                    : "Being assigned…"
                }
              />
              {job.notes ? (
                <DetailRow dt="Notes" dd={job.notes} />
              ) : null}
            </dl>
          </section>

          <section className="cl-tile cl-tile-pad-lg">
            <h2 className="cl-title-md" style={{ marginBottom: 6 }}>
              Message your cleaner
            </h2>
            <p
              style={{
                fontSize: 13,
                color: "var(--primary-60)",
                margin: "0 0 16px",
                lineHeight: 1.5,
              }}>
              Chat with the cleaner assigned to this booking about access,
              parking, pets or anything specific to this visit.
            </p>
            <JobChatThread
              jobId={job.id}
              otherLabel="Cleaner"
              userName={client.name ?? session.user.name ?? undefined}
              height={320}
            />
          </section>

          {job.addOns.length ? (
            <section className="cl-tile cl-tile-pad-lg">
              <h2 className="cl-title-md" style={{ marginBottom: 18 }}>
                Add-ons
              </h2>
              <div className="cl-stack-8">
                {job.addOns.map((a, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "12px 0",
                      borderTop: i === 0 ? "none" : "1px solid var(--primary-10)",
                      fontSize: 14,
                    }}>
                    <span style={{ color: "var(--ink)" }}>{a.name}</span>
                    <span
                      style={{
                        color: "var(--primary)",
                        fontWeight: 600,
                      }}>
                      +{formatPrice(a.price)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {job.logs.length ? (
            <section className="cl-tile cl-tile-pad-lg">
              <h2 className="cl-title-md" style={{ marginBottom: 18 }}>
                Activity
              </h2>
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}>
                {job.logs.map((log) => (
                  <li
                    key={log.id}
                    style={{
                      display: "flex",
                      gap: 12,
                      paddingBottom: 12,
                      borderBottom: "1px solid var(--primary-10)",
                      fontSize: 13,
                    }}>
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "var(--primary-40)",
                        marginTop: 6,
                        flex: "0 0 auto",
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ color: "var(--ink)" }}>
                        {ACTIVITY_LABELS[log.action] ?? "Update"}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--primary-50)",
                          marginTop: 2,
                        }}>
                        {new Date(log.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        {/* Right column */}
        <div className="cl-stack-16">
          <section className="cl-tile cl-tile-pad-lg">
            <h2 className="cl-title-md" style={{ marginBottom: 18 }}>
              Price
            </h2>
            <dl className="cl-dlist">
              {job.subtotalAmount > 0 ? (
                <DetailRow
                  dt="Subtotal"
                  dd={formatPrice(job.subtotalAmount)}
                />
              ) : null}
              {job.gstAmount > 0 ? (
                <DetailRow dt="GST (5%)" dd={formatPrice(job.gstAmount)} />
              ) : null}
              {job.qstAmount > 0 ? (
                <DetailRow
                  dt="QST (9.975%)"
                  dd={formatPrice(job.qstAmount)}
                />
              ) : null}
              <div className="cl-dlist-row with-border total">
                <dt>Total</dt>
                <dd>{formatPrice(job.price)}</dd>
              </div>
              {job.depositPaid ? (
                <DetailRow
                  dt="Deposit paid"
                  dd={`−${formatPrice(20)}`}
                />
              ) : null}
              {job.refundedAmount > 0 ? (
                <DetailRow
                  dt="Refunded"
                  dd={`−${formatPrice(job.refundedAmount)}`}
                />
              ) : null}
            </dl>

            {!job.paymentReceived && !isCompletedOrPaid ? (
              <div
                style={{
                  marginTop: 18,
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  fontSize: 12,
                  color: "var(--primary-60)",
                  paddingTop: 16,
                  borderTop: "1px solid var(--primary-10)",
                  lineHeight: 1.5,
                }}>
                <CreditCard
                  size={14}
                  style={{ marginTop: 2, flex: "0 0 auto" }}
                />
                <span>
                  {job.depositPaid
                    ? "$20 deposit collected at booking. The remaining balance will be charged after your cleaning is complete."
                    : "You won't be charged until after your cleaning is complete."}
                </span>
              </div>
            ) : null}

            {isCompletedOrPaid ? (
              <a
                href={`/api/receipts/${job.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="cl-btn cl-btn-secondary"
                style={{ marginTop: 18, width: "100%" }}>
                <Download size={14} /> Download receipt
              </a>
            ) : null}
          </section>

          {isUpcoming && !hasRequest ? (
            <RequestActions
              jobId={job.id}
              startTime={job.startTime.toISOString()}
              cancellationFeeUsd={cancellationFeeUsd}
              cancellationWindowHours={cancellationWindowHours}
              cancellationReasons={cancellationReasons}
            />
          ) : null}

          <section className="cl-tile cl-tile-pad-sm">
            <h3 className="cl-title-md" style={{ marginBottom: 8 }}>
              Need help with this booking?
            </h3>
            <p
              style={{
                fontSize: 13,
                color: "var(--primary-70)",
                margin: 0,
                lineHeight: 1.55,
              }}>
              Email{" "}
              <a className="cl-link" href={`mailto:${businessEmail}`}>
                {businessEmail}
              </a>{" "}
              or text us at{" "}
              <a className="cl-link" href={`tel:${businessPhone.replace(/[^\d+]/g, "")}`}>
                {businessPhone}
              </a>
              .
            </p>
          </section>
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .cl-booking-detail-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </>
  );
}

function DetailRow({
  dt,
  dd,
}: {
  dt: string;
  dd: React.ReactNode;
}) {
  return (
    <div className="cl-dlist-row">
      <dt>{dt}</dt>
      <dd>{dd}</dd>
    </div>
  );
}
