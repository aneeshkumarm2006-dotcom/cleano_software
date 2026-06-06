import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import DocumentsClient from "./DocumentsClient";

export default async function DocumentsPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  const employeeId = session.user.id;

  const signatures = await db.documentSignature.findMany({
    where: { employeeId },
    orderBy: [{ createdAt: "desc" }],
    include: {
      document: {
        select: {
          id: true,
          title: true,
          description: true,
          version: true,
          dueDate: true,
          createdAt: true,
          fileUrl: true,
        },
      },
    },
  });

  const signatureData = signatures.map((s) => ({
    id: s.id,
    status: s.status,
    signedAt: s.signedAt?.toISOString() ?? null,
    document: {
      id: s.document.id,
      title: s.document.title,
      description: s.document.description,
      version: s.document.version,
      dueDate: s.document.dueDate?.toISOString() ?? null,
      createdAt: s.document.createdAt.toISOString(),
      hasFile: !!s.document.fileUrl,
    },
  }));

  return <DocumentsClient signatures={signatureData} />;
}
