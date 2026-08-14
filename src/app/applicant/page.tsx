import { requireApplicant } from "@/lib/page-guards";
import { db } from "@/db";
import { APPLICANT_DOCUMENT_KIND } from "@/lib/employee-files";
import ApplicantPortalClient from "./ApplicantPortalClient";

export default async function ApplicantPortalPage() {
  const session = await requireApplicant();

  const [application, documents] = await Promise.all([
    db.jobApplication.findUnique({
      where: { userId: session.user.id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    }),
    db.employeeFile.findMany({
      where: { employeeId: session.user.id, kind: APPLICANT_DOCUMENT_KIND },
      orderBy: { uploadedAt: "desc" },
      select: { id: true, fileName: true, mimeType: true, uploadedAt: true },
    }),
  ]);

  return (
    <ApplicantPortalClient
      name={session.user.name ?? "there"}
      application={
        application
          ? {
              status: application.status,
              createdAt: application.createdAt.toISOString(),
            }
          : null
      }
      documents={documents.map((d) => ({
        id: d.id,
        fileName: d.fileName,
        uploadedAt: d.uploadedAt.toISOString(),
      }))}
      messages={
        application?.messages.map((m) => ({
          id: m.id,
          authorRole: m.authorRole,
          body: m.body,
          createdAt: m.createdAt.toISOString(),
        })) ?? []
      }
    />
  );
}
