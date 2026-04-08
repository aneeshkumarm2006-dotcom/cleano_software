import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import {
  Calendar,
  Clock,
  MapPin,
  DollarSign,
  Users,
  Package,
  LogIn,
  LogOut,
  ArrowLeft,
  FileText,
} from "lucide-react";
import ClockInButton from "../ClockInButton";
import ClockOutButton from "../ClockOutButton";

type PageProps = {
  params: Promise<{ jobId: string }>;
};

export default async function JobDetailPage({ params }: PageProps) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  const { jobId } = await params;

  // Get the job and verify access
  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
      employee: true,
      cleaners: true,
      productUsage: {
        include: {
          product: true,
        },
      },
    },
  });

  if (!job) {
    redirect("/my-jobs");
  }

  // Check if user has access to this job
  const isEmployee = job.employeeId === session.user.id;
  const isCleaner = job.cleaners.some(
    (cleaner) => cleaner.id === session.user.id
  );

  if (!isEmployee && !isCleaner) {
    redirect("/my-jobs");
  }

  // Get employee's product inventory for clock out
  const employeeProducts = await db.employeeProduct.findMany({
    where: {
      employeeId: session.user.id,
    },
    include: {
      product: true,
    },
  });

  const jobWithClock = job as any;
  const duration =
    jobWithClock.clockInTime && jobWithClock.clockOutTime
      ? Math.round(
          (new Date(jobWithClock.clockOutTime).getTime() -
            new Date(jobWithClock.clockInTime).getTime()) /
            1000 /
            60
        )
      : null;

  const canClockIn = !jobWithClock.clockInTime && job.status !== "COMPLETED";
  const canClockOut = jobWithClock.clockInTime && !jobWithClock.clockOutTime;

  return (
    <div className="space-y-4">
      {/* Header */}
      <Button variant="cleano" size="sm" href="/my-jobs" className="mb-4">
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to My Jobs
      </Button>

      <Card variant="ghost" className="py-6">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <h1 className="text-3xl font-[400] text-neutral-950">
              {job.clientName}
            </h1>
            {job.location && (
              <div className="flex items-center gap-2 text-neutral-950/70 mt-2">
                <MapPin className="w-4 h-4" />
                <span>{job.location}</span>
              </div>
            )}
            {job.description && (
              <p className="text-neutral-950/60 mt-2">{job.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 mt-4">
          <Badge
            variant={
              job.status === "COMPLETED"
                ? "cleano"
                : job.status === "IN_PROGRESS"
                ? "secondary"
                : "default"
            }>
            {job.status.replace("_", " ")}
          </Badge>
          {job.jobType && (
            <Badge variant="cleano">
              {job.jobType === "R"
                ? "Residential"
                : job.jobType === "C"
                ? "Commercial"
                : job.jobType === "PC"
                ? "Post-Construction"
                : job.jobType === "F"
                ? "Follow-up"
                : job.jobType}
            </Badge>
          )}
        </div>
      </Card>

      {/* Clock In/Out Actions */}
      {(canClockIn || canClockOut) && (
        <Card variant="default" className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-[400] text-neutral-950">
                Time Tracking
              </h2>
              <p className="text-sm text-neutral-950/60 mt-1">
                {canClockIn && "Clock in to start your shift"}
                {canClockOut && "Clock out when you finish the job"}
              </p>
            </div>
            <div className="flex gap-3">
              {canClockIn && (
                <ClockInButton jobId={job.id} jobStartTime={job.startTime} />
              )}
              {canClockOut && (
                <ClockOutButton
                  jobId={job.id}
                  employeeProducts={employeeProducts}
                />
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Time Summary */}
      {jobWithClock.clockInTime && (
        <>
          <h2 className="text-lg font-[400] text-neutral-950 mt-8">
            Time Summary
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            <Card variant="cleano_light_bordered" className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-neutral-950/20 rounded-lg">
                  <LogIn className="w-5 h-5 text-neutral-950" />
                </div>
                <div className="text-sm font-[400] text-neutral-950/70">
                  Clocked In
                </div>
              </div>
              <div className="text-2xl font-[400] text-neutral-950">
                {new Date(jobWithClock.clockInTime).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                })}
              </div>
            </Card>

            {jobWithClock.clockOutTime && (
              <>
                <Card variant="cleano_light_bordered" className="p-6">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-neutral-950/20 rounded-lg">
                      <LogOut className="w-5 h-5 text-neutral-950" />
                    </div>
                    <div className="text-sm font-[400] text-neutral-950/70">
                      Clocked Out
                    </div>
                  </div>
                  <div className="text-2xl font-[400] text-neutral-950">
                    {new Date(jobWithClock.clockOutTime).toLocaleString(
                      "en-US",
                      {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        hour12: true,
                      }
                    )}
                  </div>
                </Card>

                {duration && (
                  <Card variant="cleano_light_bordered" className="p-6">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="p-2 bg-neutral-950/20 rounded-lg">
                        <Clock className="w-5 h-5 text-neutral-950" />
                      </div>
                      <div className="text-sm font-[400] text-neutral-950/70">
                        Total Duration
                      </div>
                    </div>
                    <div className="text-2xl font-[400] text-neutral-950">
                      {Math.floor(duration / 60)}h {duration % 60}m
                    </div>
                  </Card>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* Job Details */}
      <h2 className="text-lg font-[400] text-neutral-950 mt-12">Job Details</h2>
      <div className="grid gap-6 md:grid-cols-2">
        {/* Date & Time */}
        <Card variant="default" className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-neutral-950/20 rounded-lg">
              <Calendar className="w-5 h-5 text-neutral-950" />
            </div>
            <h2 className="text-lg font-[400] text-neutral-950">Date & Time</h2>
          </div>
          <dl className="space-y-3">
            {job.jobDate && (
              <div className="flex justify-between items-center">
                <dt className="text-sm text-neutral-950/60">Job Date</dt>
                <dd className="text-sm font-[400] text-neutral-950">
                  {new Date(job.jobDate).toLocaleDateString("en-US", {
                    weekday: "short",
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </dd>
              </div>
            )}
            {job.startTime && (
              <div className="flex justify-between items-center">
                <dt className="text-sm text-neutral-950/60">Start Time</dt>
                <dd className="text-sm font-[400] text-neutral-950">
                  {new Date(job.startTime).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                  })}
                </dd>
              </div>
            )}
            {job.endTime && (
              <div className="flex justify-between items-center">
                <dt className="text-sm text-neutral-950/60">End Time</dt>
                <dd className="text-sm font-[400] text-neutral-950">
                  {new Date(job.endTime).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                  })}
                </dd>
              </div>
            )}
          </dl>
        </Card>

        {/* Team & Compensation */}
        <Card variant="default" className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-neutral-950/20 rounded-lg">
              <Users className="w-5 h-5 text-neutral-950" />
            </div>
            <h2 className="text-lg font-[400] text-neutral-950">Team</h2>
          </div>
          <dl className="space-y-3">
            <div className="flex justify-between items-center">
              <dt className="text-sm text-neutral-950/60">Lead</dt>
              <Badge variant="cleano">{job.employee.name}</Badge>
            </div>
            {job.cleaners.length > 0 && (
              <div className="flex justify-between items-center">
                <dt className="text-sm text-neutral-950/60">Team Members</dt>
                <dd className="flex flex-wrap gap-2 justify-end">
                  {job.cleaners.map((cleaner: any) => (
                    <Badge key={cleaner.id} variant="cleano">
                      {cleaner.name}
                    </Badge>
                  ))}
                </dd>
              </div>
            )}
            {job.employeePay !== null && isEmployee && (
              <div className="flex justify-between items-center pt-2 border-t border-neutral-950/10">
                <dt className="text-sm text-neutral-950/60 flex items-center gap-1">
                  <DollarSign className="w-4 h-4" />
                  Your Pay
                </dt>
                <dd className="text-lg font-[400] text-neutral-950">
                  ${job.employeePay.toFixed(2)}
                </dd>
              </div>
            )}
          </dl>
        </Card>
      </div>

      {/* Notes */}
      {job.notes && (
        <div>
          <h2 className="text-lg font-[400] text-neutral-950 mt-12">Notes</h2>
          <Card variant="cleano_light_bordered">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-neutral-950/20 rounded-lg">
                <FileText className="w-5 h-5 text-neutral-950" />
              </div>
              <h2 className="text-lg font-[400] text-neutral-950">Notes</h2>
            </div>
            <p className="text-neutral-950/70 whitespace-pre-wrap leading-relaxed">
              {job.notes}
            </p>
          </Card>
        </div>
      )}

      {/* Product Usage */}
      {job.productUsage.length > 0 && (
        <>
          <h2 className="text-lg font-[400] text-neutral-950 mt-12">
            Product Usage
          </h2>
          <Card variant="default" className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-neutral-950/20 rounded-lg">
                <Package className="w-5 h-5 text-neutral-950" />
              </div>
              <h2 className="text-lg font-[400] text-neutral-950">
                Products Used
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-neutral-950/10">
                <thead className="bg-neutral-950/10">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-[400] text-neutral-950/70 uppercase tracking-wider">
                      Product
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-[400] text-neutral-950/70 uppercase tracking-wider">
                      Quantity
                    </th>
                    {jobWithClock.clockOutTime && (
                      <>
                        <th className="px-4 py-3 text-left text-xs font-[400] text-neutral-950/70 uppercase tracking-wider">
                          Before
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-[400] text-neutral-950/70 uppercase tracking-wider">
                          After
                        </th>
                      </>
                    )}
                    {job.productUsage.some((u: any) => u.notes) && (
                      <th className="px-4 py-3 text-left text-xs font-[400] text-neutral-950/70 uppercase tracking-wider">
                        Notes
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-transparent divide-y divide-neutral-950/10">
                  {job.productUsage.map((usage: any) => (
                    <tr key={usage.id} className="hover:bg-neutral-950/5">
                      <td className="px-4 py-3 text-sm font-[400] text-neutral-950">
                        {usage.product.name}
                      </td>
                      <td className="px-4 py-3 text-sm text-neutral-950">
                        {usage.quantity} {usage.product.unit}
                      </td>
                      {jobWithClock.clockOutTime && (
                        <>
                          <td className="px-4 py-3 text-sm text-neutral-950/70">
                            {usage.inventoryBefore !== null
                              ? `${usage.inventoryBefore} ${usage.product.unit}`
                              : "-"}
                          </td>
                          <td className="px-4 py-3 text-sm text-neutral-950/70">
                            {usage.inventoryAfter !== null
                              ? `${usage.inventoryAfter} ${usage.product.unit}`
                              : "-"}
                          </td>
                        </>
                      )}
                      {job.productUsage.some((u: any) => u.notes) && (
                        <td className="px-4 py-3 text-sm text-neutral-950/70">
                          {usage.notes || "-"}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
