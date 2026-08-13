import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import SalesPageClient from "./SalesPageClient";
import { SALES_REP_ROLES } from "./commissionTypes";
import { storeMonthPeriod } from "@/lib/timezone";

export default async function SalesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const role = (session.user as any).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    redirect("/admin/dashboard");
  }

  const [salesAreas, landingPages, campaigns, commissions, reps, recentLeads] = await Promise.all([
    db.salesArea.findMany({
      orderBy: { date: "desc" },
    }),
    db.landingPage.findMany({
      include: {
        campaign: { select: { id: true, name: true } },
        _count: { select: { visits: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.marketingCampaign.findMany({
      include: {
        _count: { select: { landingPages: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    // Commissions (item 20). Newest period first, then newest entry — the tab
    // is worked from the top, and the top is what is owed right now.
    db.commission.findMany({
      orderBy: [{ period: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        salesRepId: true,
        amount: true,
        rate: true,
        period: true,
        note: true,
        paidAt: true,
        createdAt: true,
        salesRep: { select: { name: true } },
        job: { select: { id: true, jobNumber: true } },
        lead: { select: { id: true, name: true, email: true } },
      },
    }),
    db.user.findMany({
      where: { deletedAt: null, isActive: true, role: { in: SALES_REP_ROLES } },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
    db.lead.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, email: true },
      orderBy: { lastActivityAt: "desc" },
      take: 100,
    }),
  ]);

  // Get visit counts per landing page for the last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentVisits = await db.pageVisit.groupBy({
    by: ["landingPageId"],
    where: { createdAt: { gte: thirtyDaysAgo } },
    _count: true,
  });

  const recentVisitMap = new Map(
    recentVisits.map((v) => [v.landingPageId, v._count])
  );

  const serializedSalesAreas = salesAreas.map((sa) => ({
    id: sa.id,
    name: sa.name,
    type: sa.type,
    latitude: sa.latitude,
    longitude: sa.longitude,
    address: sa.address,
    notes: sa.notes,
    date: sa.date.toISOString(),
    createdAt: sa.createdAt.toISOString(),
  }));

  const serializedLandingPages = landingPages.map((lp) => ({
    id: lp.id,
    title: lp.title,
    slug: lp.slug,
    content: lp.content,
    ctaText: lp.ctaText,
    ctaLink: lp.ctaLink,
    isPublished: lp.isPublished,
    campaignId: lp.campaignId,
    campaignName: lp.campaign?.name || null,
    totalVisits: lp._count.visits,
    recentVisits: recentVisitMap.get(lp.id) || 0,
    createdAt: lp.createdAt.toISOString(),
  }));

  const serializedCampaigns = campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    status: c.status,
    budget: c.budget,
    spent: c.spent,
    startDate: c.startDate?.toISOString() || null,
    endDate: c.endDate?.toISOString() || null,
    channel: c.channel,
    notes: c.notes,
    landingPageCount: c._count.landingPages,
    createdAt: c.createdAt.toISOString(),
  }));

  const serializedCommissions = commissions.map((c) => ({
    id: c.id,
    salesRepId: c.salesRepId,
    salesRepName: c.salesRep.name,
    amount: c.amount,
    rate: c.rate,
    period: c.period,
    note: c.note,
    paidAt: c.paidAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    jobId: c.job?.id ?? null,
    jobNumber: c.job?.jobNumber ?? null,
    leadId: c.lead?.id ?? null,
    leadLabel: c.lead ? c.lead.name || c.lead.email : null,
  }));

  const leadOptions = recentLeads.map((l) => ({
    id: l.id,
    label: l.name ? `${l.name} · ${l.email}` : l.email,
  }));

  const stats = {
    totalAreas: salesAreas.length,
    totalPages: landingPages.length,
    publishedPages: landingPages.filter((lp) => lp.isPublished).length,
    totalCampaigns: campaigns.length,
    activeCampaigns: campaigns.filter((c) => c.status === "ACTIVE").length,
    totalBudget: campaigns.reduce((sum, c) => sum + c.budget, 0),
    totalSpent: campaigns.reduce((sum, c) => sum + c.spent, 0),
    totalVisits: landingPages.reduce((sum, lp) => sum + lp._count.visits, 0),
  };

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <SalesPageClient
        salesAreas={serializedSalesAreas}
        landingPages={serializedLandingPages}
        campaigns={serializedCampaigns}
        stats={stats}
        commissions={serializedCommissions}
        reps={reps}
        leadOptions={leadOptions}
        currentPeriod={storeMonthPeriod()}
      />
    </div>
  );
}
