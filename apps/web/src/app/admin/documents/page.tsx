import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/org-db";
import DocumentsClient from "./DocumentsClient";
import { getMyVoidCheque } from "../actions/getMyVoidCheque";

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

  // This page is shared: /cleaners/documents re-exports it. The void cheque is
  // the VIEWER'S own file either way, so loading it here is safe for both
  // routes — DocumentsClient decides whether the payroll section renders, off
  // the same `isAdminView` path check it already used for the settings banner.
  // Metadata only; the file itself is never reachable from this page.
  const voidCheque = await getMyVoidCheque();

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <DocumentsClient signatures={signatureData} voidCheque={voidCheque} />
    </div>
  );
}
