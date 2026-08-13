import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import Link from "next/link";
import { CalendarClock, MapPin, Gift } from "lucide-react";
import { StatusBadge, DateBadge } from "@/components/customer/atoms";
import { STORE_TZ } from "@/lib/timezone";

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: STORE_TZ,
  });
}

function formatPrice(n: number | null | undefined) {
  return `$${(n ?? 0).toFixed(2)}`;
}

export default async function PortalHome() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const email = session.user.email?.toLowerCase();
  const client = email
    ? await db.client.findFirst({ where: { email } })
    : null;

  if (!client) {
    return (
      <div className="cl-tile cl-tile-pad-lg" style={{ textAlign: "center" }}>
        <h1 className="cl-title" style={{ marginBottom: 12 }}>
          We can't find your bookings
        </h1>
        <p className="cl-subtitle" style={{ marginBottom: 24 }}>
          The email on your account doesn't match any client record. If you've
          recently booked, please contact us so we can link your account.
        </p>
        <Link href="/book" className="cl-btn cl-btn-primary">
          Book a cleaning
        </Link>
      </div>
    );
  }

  const now = new Date();
  const [upcoming, pastCount] = await Promise.all([
    db.job.findMany({
      // Archived bookings are gone from the customer's portal (item 1).
      where: { clientId: client.id, deletedAt: null, startTime: { gte: now } },
      orderBy: { startTime: "asc" },
      take: 5,
      include: { cleaners: { select: { id: true, name: true } } },
    }),
    db.job.count({
      where: { clientId: client.id, deletedAt: null, startTime: { lt: now } },
    }),
  ]);

  const firstName = client.name.split(/\s+/)[0] ?? client.name;
  const nextOne = upcoming[0];

  return (
    <>
      <header className="cl-stack-8" style={{ marginBottom: 36 }}>
        <p className="cl-eyebrow">Overview</p>
        <h1
          className="cl-display"
          style={{ fontSize: "clamp(34px, 4.2vw, 52px)" }}>
          Welcome back,
          <br />
          <em>{firstName}.</em>
        </h1>
        {nextOne ? (
          <p className="cl-subtitle" style={{ fontSize: 16, marginTop: 12 }}>
            Your next cleaning is{" "}
            <strong style={{ color: "var(--ink)" }}>
              {new Date(nextOne.startTime).toLocaleDateString("en-US", {
                weekday: "long",
                timeZone: STORE_TZ,
              })}{" "}
              at {formatTime(nextOne.startTime.toISOString())}
            </strong>
            {nextOne.cleaners.length ? (
              <>
                {" "}with{" "}
                <strong style={{ color: "var(--ink)" }}>
                  {nextOne.cleaners[0].name}
                </strong>
              </>
            ) : null}
            .
          </p>
        ) : (
          <p className="cl-subtitle" style={{ fontSize: 16, marginTop: 12 }}>
            No upcoming cleanings.{" "}
            <Link href="/book" className="cl-link">
              Book your next one →
            </Link>
          </p>
        )}
      </header>

      <div className="cl-grid-3" style={{ marginBottom: 36 }}>
        <StatTile
          icon={<CalendarClock size={20} />}
          label="Upcoming"
          value={String(upcoming.length)}
          hint={upcoming.length === 1 ? "cleaning scheduled" : "cleanings scheduled"}
        />
        <StatTile
          icon={<MapPin size={20} />}
          label="Past visits"
          value={String(pastCount)}
          hint={`${pastCount} completed since joining`}
        />
        <StatTile
          icon={<Gift size={20} />}
          label="Referral credit"
          value={formatPrice(client.referralCredit)}
          hint={client.referralCode ? `Code · ${client.referralCode}` : undefined}
        />
      </div>

      <div className="cl-tile cl-tile-pad-lg">
        <div className="cl-tile-head">
          <h2>Upcoming bookings</h2>
          <Link
            href="/bookings"
            className="cl-link-muted"
            style={{ fontSize: 13 }}>
            View all →
          </Link>
        </div>

        {upcoming.length === 0 ? (
          <div
            style={{
              padding: "32px 0",
              textAlign: "center",
              color: "var(--primary-60)",
              fontSize: 14,
            }}>
            No upcoming bookings yet.{" "}
            <Link href="/book" className="cl-link">
              Book one now →
            </Link>
          </div>
        ) : (
          <div>
            {upcoming.map((j) => (
              <div key={j.id} className="cl-booking-row">
                <div className="cl-row-between" style={{ alignItems: "flex-start" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 18 }}>
                    <DateBadge iso={j.startTime.toISOString()} />
                    <div className="cl-stack-4">
                      <div style={{ fontSize: 15, fontWeight: 500, color: "var(--ink)" }}>
                        {j.jobType ?? "Cleaning"} · {formatTime(j.startTime.toISOString())}
                        {j.isFlexible ? (
                          <span style={{ fontSize: 12, color: "var(--primary-50)", marginLeft: 8, fontWeight: 400 }}>
                            (flexible)
                          </span>
                        ) : null}
                      </div>
                      <div style={{ fontSize: 13, color: "var(--primary-60)" }}>
                        {j.cleaners.length
                          ? `with ${j.cleaners.map((c) => c.name).join(", ")}`
                          : "Cleaner being assigned…"}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "var(--font-cl-serif)", fontSize: 20, color: "var(--primary)" }}>
                      {formatPrice(j.price)}
                    </div>
                    <StatusBadge status={j.status} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function StatTile({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="cl-stat-tile">
      <div className="cl-stat-tile-icon">{icon}</div>
      <div>
        <div className="cl-stat-tile-label" style={{ marginBottom: 8 }}>
          {label}
        </div>
        <div className="cl-stat-tile-value">{value}</div>
      </div>
      {hint ? <div className="cl-stat-tile-hint">{hint}</div> : null}
    </div>
  );
}
