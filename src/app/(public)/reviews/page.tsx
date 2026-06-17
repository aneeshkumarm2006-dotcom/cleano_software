import { db } from "@/db";
import { getSettings } from "@/lib/settings";

// Reviews + settings change at runtime, so render per request.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Reviews · Cleano",
  description: "See what Cleano customers say about our cleaning services.",
};

/** "John Smith" → "John S." — protects customer privacy on the public wall. */
function shortName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "A Cleano customer";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export default async function ReviewsPage() {
  const { "customer.liveReviewsEnabled": enabled, "customer.liveReviewThreshold": threshold } =
    await getSettings([
      "customer.liveReviewsEnabled",
      "customer.liveReviewThreshold",
    ]);

  const ratings = enabled
    ? await db.employeeRating.findMany({
        where: { rating: { gte: threshold }, notes: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: { job: { include: { client: { select: { name: true } } } } },
      })
    : [];

  const reviews = ratings.filter((r) => (r.notes ?? "").trim().length > 0);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #f7faf9 0%, #ffffff 100%)",
        padding: "48px 16px",
      }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <header style={{ marginBottom: 28, textAlign: "center" }}>
          <div
            style={{
              fontSize: 12,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#008C9C",
              fontWeight: 700,
            }}>
            Cleano
          </div>
          <h1
            style={{
              marginTop: 8,
              fontSize: "clamp(28px, 5vw, 44px)",
              lineHeight: 1.1,
              color: "#0a1f24",
              fontWeight: 700,
            }}>
            What our customers say
          </h1>
        </header>

        {reviews.length === 0 ? (
          <p style={{ textAlign: "center", color: "#3a5a62", fontSize: 15 }}>
            No reviews to show yet — check back soon.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {reviews.map((r) => (
              <div
                key={r.id}
                style={{
                  background: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: 14,
                  padding: "16px 20px",
                }}>
                <div
                  style={{
                    color: "#f59e0b",
                    fontSize: 15,
                    letterSpacing: 1,
                    marginBottom: 6,
                  }}>
                  {"★".repeat(Math.round(r.rating))}
                  <span style={{ color: "#d1d5db" }}>
                    {"★".repeat(Math.max(0, 5 - Math.round(r.rating)))}
                  </span>
                </div>
                <p
                  style={{
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: "#0a1f24",
                    marginBottom: 8,
                    whiteSpace: "pre-wrap",
                  }}>
                  {r.notes}
                </p>
                <p style={{ fontSize: 13, color: "#6b7280", fontWeight: 600 }}>
                  — {shortName(r.job?.client?.name)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
