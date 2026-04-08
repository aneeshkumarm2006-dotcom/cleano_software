import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import Card from "@/components/ui/Card";
import { Prisma } from "@prisma/client";
import { JobsFilters } from "./JobsFilters";
import { JobsPagination } from "./JobsPagination";
import { TableHeader } from "./TableHeader";
import { TableLoadingOverlay } from "./TableLoadingOverlay";
import { JobsLoadingProvider } from "./JobsLoadingContext";
import { ClearLoadingOnMount } from "./ClearLoadingOnMount";
import { JobRow } from "./JobRow";
import { Calendar } from "lucide-react";

type SearchParams = Promise<{
  [key: string]: string | string[] | undefined;
}>;

export default async function MyJobsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  // Parse search params
  const params = await searchParams;
  const cursor = (params.cursor as string) || null;
  const direction = (params.direction as string) || null;
  const perPage = Number(params.perPage) || 10;
  const search = (params.search as string) || "";
  const status = (params.status as string) || "all";
  const jobType = (params.jobType as string) || "all";
  const sortBy = (params.sortBy as string) || "jobDate";
  const sortOrder = (params.sortOrder as string) || "asc";

  // Build where clause
  const where: Prisma.JobWhereInput = {
    OR: [
      { employeeId: session.user.id },
      {
        cleaners: {
          some: {
            id: session.user.id,
          },
        },
      },
    ],
  };

  // Search filter
  if (search) {
    where.AND = [
      {
        OR: [
          { clientName: { contains: search, mode: "insensitive" } },
          { location: { contains: search, mode: "insensitive" } },
        ],
      },
    ];
  }

  // Status filter - we'll apply this after fetching
  // (Some filters need to check clockInTime/clockOutTime which aren't in Prisma filters)

  // Job type filter
  if (jobType !== "all") {
    where.jobType = jobType;
  }

  // Cursor-based pagination
  const take = perPage + 1; // Fetch one extra to check if there's a next page
  const orderBy: any = { [sortBy]: sortOrder };

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
    const reverseOrder: any = {
      [sortBy]: sortOrder === "asc" ? "desc" : "asc",
    };
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

  // Apply status filter (client-side for clock-in/out times)
  let filteredJobs = jobs;
  if (status === "upcoming") {
    filteredJobs = jobs.filter(
      (job) =>
        job.status !== "COMPLETED" &&
        job.status !== "CANCELLED" &&
        !(job as any).clockOutTime
    );
  } else if (status === "in_progress") {
    filteredJobs = jobs.filter(
      (job) => (job as any).clockInTime && !(job as any).clockOutTime
    );
  } else if (status === "completed") {
    filteredJobs = jobs.filter(
      (job) => job.status === "COMPLETED" || (job as any).clockOutTime
    );
  }

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

  return (
    <JobsLoadingProvider>
      <ClearLoadingOnMount dataKey={dataKey} />
      <div className="space-y-6">
        {/* Header */}
        <Card variant="ghost">
          <div className="flex justify-between items-center">
            <h1 className="text-3xl font-[400] text-gray-900">My Jobs</h1>
          </div>
        </Card>

        {/* Search and Filters */}
        <JobsFilters />

        {/* Jobs Table */}
        <Card variant="default">
          <div className="overflow-hidden rounded-lg relative">
            <TableLoadingOverlay />
            <div className="overflow-x-auto">
              {/* Header row */}
              <div className="flex bg-gray-50/50 min-w-max">
                <div className="w-[200px] min-w-[200px]">
                  <TableHeader label="Client" sortKey="clientName" />
                </div>
                <span className="px-6 py-3 text-left text-xs font-[400] text-gray-500 uppercase tracking-wider flex items-center w-[220px] min-w-[220px]">
                  Location
                </span>
                <div className="w-[140px] min-w-[140px]">
                  <TableHeader label="Date" sortKey="jobDate" />
                </div>
                <div className="w-[140px] min-w-[140px]">
                  <TableHeader label="Start Time" sortKey="startTime" />
                </div>
                <span className="px-6 py-3 text-left text-xs font-[400] text-gray-500 uppercase tracking-wider flex items-center w-[140px] min-w-[140px]">
                  End Time
                </span>
                <span className="px-6 py-3 text-left text-xs font-[400] text-gray-500 uppercase tracking-wider flex items-center w-[150px] min-w-[150px]">
                  Actual End
                </span>
                <div className="w-[200px] min-w-[200px]">
                  <TableHeader label="Status" sortKey="status" />
                </div>
                <span className="px-6 py-3 text-right text-xs font-[400] text-gray-500 uppercase tracking-wider flex items-center justify-end w-[160px] min-w-[160px]">
                  Actions
                </span>
              </div>
              {/* Jobs - Fixed height for 10 rows */}
              <div className="bg-white divide-y divide-gray-50 relative">
                {filteredJobs.length === 0 ? (
                  <>
                    <div className="px-6 py-8 text-center text-sm text-gray-500">
                      {search || status !== "all" || jobType !== "all" ? (
                        <>
                          <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                          <p>No jobs found matching your filters.</p>
                        </>
                      ) : (
                        <>
                          <p className="font-[400] text-gray-900 mb-1">
                            No Jobs Assigned
                          </p>
                          <p>
                            You don&apos;t have any jobs assigned to you yet
                          </p>
                        </>
                      )}
                    </div>
                    {/* Placeholder rows */}
                    {Array.from({ length: minDisplayRows - 1 }).map(
                      (_, idx) => (
                        <div
                          key={`placeholder-${idx}`}
                          className="flex h-16 min-w-max">
                          <div className="px-6 py-4 w-[200px] min-w-[200px]"></div>
                          <div className="px-6 py-4 w-[220px] min-w-[220px]"></div>
                          <div className="px-6 py-4 w-[140px] min-w-[140px]"></div>
                          <div className="px-6 py-4 w-[140px] min-w-[140px]"></div>
                          <div className="px-6 py-4 w-[140px] min-w-[140px]"></div>
                          <div className="px-6 py-4 w-[150px] min-w-[150px]"></div>
                          <div className="px-6 py-4 w-[200px] min-w-[200px]"></div>
                          <div className="px-6 py-4 w-[160px] min-w-[160px]"></div>
                        </div>
                      )
                    )}
                  </>
                ) : (
                  <>
                    {filteredJobs.map((job) => (
                      <JobRow
                        key={job.id}
                        job={job}
                        isMainEmployee={isMainEmployee(job.id)}
                      />
                    ))}
                    {/* Placeholder rows to fill up to minimum display rows */}
                    {placeholderRowCount > 0 &&
                      Array.from({ length: placeholderRowCount }).map(
                        (_, idx) => (
                          <div
                            key={`placeholder-${idx}`}
                            className="flex h-16 min-w-max">
                            <div className="px-6 py-4 w-[200px] min-w-[200px]"></div>
                            <div className="px-6 py-4 w-[220px] min-w-[220px]"></div>
                            <div className="px-6 py-4 w-[140px] min-w-[140px]"></div>
                            <div className="px-6 py-4 w-[140px] min-w-[140px]"></div>
                            <div className="px-6 py-4 w-[140px] min-w-[140px]"></div>
                            <div className="px-6 py-4 w-[150px] min-w-[150px]"></div>
                            <div className="px-6 py-4 w-[200px] min-w-[200px]"></div>
                            <div className="px-6 py-4 w-[160px] min-w-[160px]"></div>
                          </div>
                        )
                      )}
                  </>
                )}
              </div>
            </div>
          </div>
        </Card>

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
