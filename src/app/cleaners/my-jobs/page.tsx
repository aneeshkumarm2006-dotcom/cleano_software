import { db } from "@/db";
import { requireCleaner } from "@/lib/page-guards";
import { Prisma } from "@prisma/client";
import {
  cleanerAssignedWhere,
  upcomingFilter,
  inProgressFilter,
  doneFilter,
  cancelledFilter,
  pastFilter,
} from "@/lib/cleaner-jobs";
import { JobsFilters } from "./JobsFilters";
import { JobsPagination } from "./JobsPagination";
import { TableLoadingOverlay } from "./TableLoadingOverlay";
import { JobsLoadingProvider } from "./JobsLoadingContext";
import { ClearLoadingOnMount } from "./ClearLoadingOnMount";
import { JobRow } from "./JobRow";
import { Calendar } from "lucide-react";
import PendingInvitesPanel from "./PendingInvitesPanel";

type SearchParams = Promise<{
  [key: string]: string | string[] | undefined;
}>;

export default async function MyJobsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireCleaner();

  // Parse search params (allow-list everything that reaches the query)
  const params = await searchParams;
  const cursor = (params.cursor as string) || null;
  const direction = (params.direction as string) || null;
  const perPage = Math.min(Math.max(Number(params.perPage) || 10, 1), 100);
  const search = (params.search as string) || "";
  const validStatuses = ["all", "upcoming", "in_progress", "completed", "cancelled", "past"];
  const statusParam = (params.status as string) || "upcoming";
  // Default view: upcoming jobs, soonest first.
  const status = validStatuses.includes(statusParam) ? statusParam : "upcoming";
  const jobType = (params.jobType as string) || "all";
  const validSortFields = ["jobDate", "startTime", "clientName", "createdAt", "status"];
  const sortByParam = (params.sortBy as string) || "startTime";
  const sortBy = validSortFields.includes(sortByParam) ? sortByParam : "startTime";
  // Upcoming/in-progress read best soonest-first; history reads best most-recent-first.
  const defaultSortOrder = status === "upcoming" || status === "in_progress" ? "asc" : "desc";
  const sortOrder: "asc" | "desc" =
    params.sortOrder === "asc" || params.sortOrder === "desc"
      ? params.sortOrder
      : defaultSortOrder;

  const now = new Date();

  // Base scope + status predicates come from @/lib/cleaner-jobs so My Jobs, the
  // Cleaner Dashboard and the Cleaner Calendar agree on what "upcoming" means.
  const where: Prisma.JobWhereInput = cleanerAssignedWhere(session.user.id);

  const andFilters: Prisma.JobWhereInput[] = [];

  // Search filter
  if (search) {
    andFilters.push({
      OR: [
        { clientName: { contains: search, mode: "insensitive" } },
        { location: { contains: search, mode: "insensitive" } },
      ],
    });
  }

  // Status filter — applied in SQL so cursor pagination stays correct.
  if (status === "upcoming") {
    andFilters.push(upcomingFilter(now));
  } else if (status === "in_progress") {
    andFilters.push(inProgressFilter());
  } else if (status === "completed") {
    andFilters.push(doneFilter());
  } else if (status === "cancelled") {
    andFilters.push(cancelledFilter());
  } else if (status === "past") {
    andFilters.push(pastFilter(now));
  }

  // Job type filter
  if (jobType !== "all") {
    andFilters.push({ jobType });
  }

  if (andFilters.length > 0) {
    where.AND = andFilters;
  }

  // Cursor-based pagination
  const take = perPage + 1; // Fetch one extra to check if there's a next page
  // Secondary sort on id keeps the cursor stable when jobs share the same date.
  const orderBy: Prisma.JobOrderByWithRelationInput[] = [
    { [sortBy]: sortOrder },
    { id: sortOrder },
  ];

  let jobs;

  if (cursor && direction === "next") {
    // Next page
    jobs = await db.job.findMany({
      where,
      include: {
        employee: true,
        cleaners: true,
        productUsage: {
          include: {
            product: true,
          },
        },
      },
      orderBy,
      take,
      skip: 1, // Skip the cursor
      cursor: { id: cursor },
    });
  } else if (cursor && direction === "prev") {
    // Previous page - reverse the order
    const flipped: "asc" | "desc" = sortOrder === "asc" ? "desc" : "asc";
    const reverseOrder: Prisma.JobOrderByWithRelationInput[] = [
      { [sortBy]: flipped },
      { id: flipped },
    ];
    jobs = await db.job.findMany({
      where,
      include: {
        employee: true,
        cleaners: true,
        productUsage: {
          include: {
            product: true,
          },
        },
      },
      orderBy: reverseOrder,
      take,
      skip: 1, // Skip the cursor
      cursor: { id: cursor },
    });
    // Reverse the results back to correct order
    jobs = jobs.reverse();
  } else {
    // First page
    jobs = await db.job.findMany({
      where,
      include: {
        employee: true,
        cleaners: true,
        productUsage: {
          include: {
            product: true,
          },
        },
      },
      orderBy,
      take,
    });
  }

  // Status filtering happens in the query, so pagination math is exact.
  const filteredJobs = jobs;

  // Check if there are more pages
  const hasNextPage = filteredJobs.length > perPage;
  if (hasNextPage) {
    filteredJobs.pop(); // Remove the extra item
  }

  // Check if there's a previous page (we have a cursor and we're not on the first page)
  const hasPrevPage = Boolean(cursor);

  // Get cursors for pagination
  const nextCursor = hasNextPage
    ? filteredJobs[filteredJobs.length - 1]?.id
    : null;
  const prevCursor = filteredJobs[0]?.id || null;

  // Calculate minimum rows to display based on perPage
  const minDisplayRows = Math.min(perPage, 10);
  const placeholderRowCount = Math.max(0, minDisplayRows - filteredJobs.length);

  // Create a unique key based on search params to detect data changes
  const dataKey = `${cursor}-${search}-${status}-${jobType}-${sortBy}-${sortOrder}-${perPage}-${filteredJobs.length}`;

  const isMainEmployee = (jobId: string) => {
    const job = filteredJobs.find((j) => j.id === jobId);
    return job?.employeeId === session.user.id;
  };

  // Compute missing equipment per upcoming job (for warning icon)
  const upcomingJobs = filteredJobs.filter(
    (j) =>
      j.status !== "COMPLETED" &&
      j.status !== "CANCELLED" &&
      !(j as any).clockOutTime
  );

  const missingEquipmentByJob = new Map<
    string,
    { productId: string; productName: string; needed: number; have: number }[]
  >();

  if (upcomingJobs.length > 0) {
    const [employeeProducts, kitTemplates, inventoryRules] = await Promise.all([
      db.employeeProduct.findMany({
        where: { employeeId: session.user.id },
        include: { product: true },
      }),
      db.kitTemplate.findMany({
        where: { isActive: true },
        include: { items: { include: { product: true } } },
      }),
      db.inventoryRule.findMany({
        where: { usagePerJob: { gt: 0 } },
        include: { product: true },
      }),
    ]);

    const employeeInventory = new Map<string, number>();
    for (const ep of employeeProducts) {
      employeeInventory.set(ep.productId, ep.quantity);
    }

    const kitsByName = new Map<string, (typeof kitTemplates)[number]>();
    for (const k of kitTemplates) {
      kitsByName.set(k.name.toLowerCase(), k);
    }

    const jobsWithAddOns = await db.job.findMany({
      where: { id: { in: upcomingJobs.map((j) => j.id) } },
      include: { addOns: true },
    });
    const addOnsByJobId = new Map<string, string[]>();
    for (const j of jobsWithAddOns) {
      addOnsByJobId.set(
        j.id,
        j.addOns.map((a) => a.name)
      );
    }

    for (const job of upcomingJobs) {
      const required = new Map<
        string,
        { needed: number; productName: string }
      >();

      const jobTypeKit = job.jobType
        ? kitsByName.get(job.jobType.toLowerCase())
        : null;
      if (jobTypeKit) {
        for (const item of jobTypeKit.items) {
          const existing = required.get(item.productId);
          if (existing) {
            existing.needed += item.quantity;
          } else {
            required.set(item.productId, {
              needed: item.quantity,
              productName: item.product.name,
            });
          }
        }
      }

      const jobAddOns = addOnsByJobId.get(job.id) || [];
      for (const addOn of jobAddOns) {
        const addOnKit = kitsByName.get(addOn.toLowerCase());
        if (addOnKit) {
          for (const item of addOnKit.items) {
            const existing = required.get(item.productId);
            if (existing) {
              existing.needed += item.quantity;
            } else {
              required.set(item.productId, {
                needed: item.quantity,
                productName: item.product.name,
              });
            }
          }
        }
      }

      // Fall back to inventory rules if no kit-derived requirements
      if (required.size === 0) {
        for (const rule of inventoryRules) {
          required.set(rule.productId, {
            needed: rule.usagePerJob,
            productName: rule.product.name,
          });
        }
      }

      const missing: {
        productId: string;
        productName: string;
        needed: number;
        have: number;
      }[] = [];
      for (const [productId, req] of required) {
        const have = employeeInventory.get(productId) ?? 0;
        if (have < req.needed) {
          missing.push({
            productId,
            productName: req.productName,
            needed: req.needed,
            have,
          });
        }
      }
      if (missing.length > 0) {
        missingEquipmentByJob.set(job.id, missing);
      }
    }
  }

  // Pending accept/decline invites for this cleaner.
  const pendingInviteRows = await db.jobAssignmentInvite.findMany({
    where: {
      cleanerId: session.user.id,
      decision: "PENDING",
      expiresAt: { gt: new Date() },
    },
    orderBy: { expiresAt: "asc" },
    include: {
      job: {
        select: {
          jobNumber: true,
          clientName: true,
          startTime: true,
          location: true,
        },
      },
    },
  });

  const pendingInvites = pendingInviteRows.map((inv) => ({
    id: inv.id,
    jobId: inv.jobId,
    jobNumber: inv.job.jobNumber,
    clientName: inv.job.clientName,
    startTime: inv.job.startTime.toISOString(),
    address: inv.job.location,
    expiresAt: inv.expiresAt.toISOString(),
    isLastMinute: inv.isLastMinute,
    bonusUsd: inv.bonusUsd,
  }));

  return (
    <JobsLoadingProvider>
      <ClearLoadingOnMount dataKey={dataKey} />
      <div className="cl-page-wrap">
        {/* Header */}
        <div className="cl-page-head">
          <div>
            <h1 className="cl-page-title">My jobs</h1>
            <p className="cl-page-sub">
              Here&apos;s everything you&apos;re booked on.
            </p>
          </div>
        </div>

        <PendingInvitesPanel invites={pendingInvites} />

        {/* Filters */}
        <JobsFilters />


        {/* Job cards */}
        <div style={{ position: "relative" }}>
          <TableLoadingOverlay />
          {filteredJobs.length === 0 ? (
            <div className="cl-empty-block">
              <div className="icon-bubble">
                <Calendar size={28} />
              </div>
              <div>
                <p style={{ fontWeight: 600, color: "var(--ink)", marginBottom: 4 }}>
                  {search || jobType !== "all" || (status !== "all" && status !== "upcoming")
                    ? "No jobs match these filters."
                    : status === "upcoming"
                      ? "No upcoming jobs."
                      : "No jobs assigned yet."}
                </p>
                <p style={{ margin: 0, fontSize: 13 }}>
                  {search || jobType !== "all" || (status !== "all" && status !== "upcoming")
                    ? "Try adjusting your search or filters."
                    : "Jobs you're assigned to will appear here."}
                </p>
              </div>
            </div>
          ) : (
            <div className="cl-jobs2-list">
              {filteredJobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  isMainEmployee={isMainEmployee(job.id)}
                  missingEquipment={missingEquipmentByJob.get(job.id) || []}
                />
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        <JobsPagination
          hasNextPage={hasNextPage}
          hasPrevPage={hasPrevPage}
          nextCursor={nextCursor}
          prevCursor={prevCursor}
          currentCount={filteredJobs.length}
          perPage={perPage}
          minDisplayRows={minDisplayRows}
        />
      </div>
    </JobsLoadingProvider>
  );
}
