import { requireAdmin } from "@/lib/page-guards";
import { db } from "@/db";
import ApplicationsInboxClient from "./ApplicationsInboxClient";

export default async function JobApplicationsPage() {
  await requireAdmin();

  const applications = await db.jobApplication.findMany({
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <ApplicationsInboxClient
        applications={applications.map((a) => ({
          id: a.id,
          name: a.name,
          email: a.email,
          phone: a.phone,
          cityArea: a.cityArea,
          availability: a.availability,
          experience: a.experience,
          hasTransport: a.hasTransport,
          resumeUrl: a.resumeUrl,
          status: a.status,
          notes: a.notes,
          createdAt: a.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
