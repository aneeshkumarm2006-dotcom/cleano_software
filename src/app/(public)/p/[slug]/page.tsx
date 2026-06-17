import { db } from "@/db";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import crypto from "crypto";

type Params = Promise<{ slug: string }>;

async function recordVisit(landingPageId: string) {
  try {
    const headersList = await headers();
    const forwarded = headersList.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() || "unknown";
    const ipHash = crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
    const referrer = headersList.get("referer") || null;
    const userAgent = headersList.get("user-agent") || null;

    await db.pageVisit.create({
      data: {
        landingPageId,
        ipHash,
        referrer,
        userAgent,
      },
    });
  } catch {
    // Silently fail — don't block page render for analytics
  }
}

export default async function LandingPageRoute({
  params,
}: {
  params: Params;
}) {
  const { slug } = await params;

  const page = await db.landingPage.findUnique({
    where: { slug },
  });

  if (!page || !page.isPublished) {
    notFound();
  }

  // Record the visit (fire and forget)
  recordVisit(page.id);

  // Split content into paragraphs
  const paragraphs = page.content.split("\n").filter((p) => p.trim());

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-4xl font-[300] tracking-tight text-[#008C9C] mb-6">
        {page.title}
      </h1>

      <div className="space-y-4 text-gray-600 text-base leading-relaxed">
        {paragraphs.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </div>

      {/* CTA */}
      <div className="mt-10 flex justify-center">
        <a
          href={page.ctaLink}
          className="inline-flex items-center px-8 py-3 bg-[#008C9C] text-white rounded-xl text-base font-[400] hover:bg-[#004a53] transition-colors shadow-sm">
          {page.ctaText}
        </a>
      </div>
    </div>
  );
}

export async function generateMetadata({ params }: { params: Params }) {
  const { slug } = await params;
  const page = await db.landingPage.findUnique({
    where: { slug },
    select: { title: true },
  });

  return {
    title: page ? `${page.title} | Cleano` : "Page Not Found",
  };
}
