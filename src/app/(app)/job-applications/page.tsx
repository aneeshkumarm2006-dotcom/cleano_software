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
          gender: a.gender,
          dateOfBirth: a.dateOfBirth,
          email: a.email,
          phone: a.phone,
          address: [
            a.addressStreet,
            a.addressLine2,
            a.cityArea,
            a.province,
            a.postalCode,
            a.country,
          ]
            .filter(Boolean)
            .join(", "),
          cityArea: a.cityArea,
          hasTransport: a.hasTransport,
          driversLicense: a.driversLicense,
          hasInsurance: a.hasInsurance,
          insuranceDetails: a.insuranceDetails,
          availability: a.availability,
          earliestStart: a.earliestStart,
          yearsExperience: a.yearsExperience,
          experienceTypes: a.experienceTypes,
          experience: a.experience,
          resumeUrl: a.resumeUrl,
          whyCleano: a.whyCleano,
          hasConviction: a.hasConviction,
          convictionDetails: a.convictionDetails,
          hearAbout: a.hearAbout,
          referrerName: a.referrerName,
          references: [
            [a.ref1Name, a.ref1Relationship, a.ref1Phone],
            [a.ref2Name, a.ref2Relationship, a.ref2Phone],
          ]
            .filter((r) => r.some(Boolean))
            .map((r) => r.filter(Boolean).join(" · ")),
          backgroundConsent: a.backgroundConsent,
          consentDate: a.consentDate,
          source: a.source,
          status: a.status,
          notes: a.notes,
          createdAt: a.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
