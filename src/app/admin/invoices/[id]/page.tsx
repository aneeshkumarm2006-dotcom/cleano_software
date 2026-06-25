import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { db } from "@/db";
import InvoiceDetailView from "./InvoiceDetailView";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    redirect("/admin/dashboard");
  }

  const { id } = await params;

  const invoice = await db.invoice.findUnique({
    where: { id },
    include: {
      client: true,
      job: {
        select: {
          id: true,
          clientName: true,
          jobType: true,
          jobDate: true,
          location: true,
          description: true,
          price: true,
          status: true,
        },
      },
      lineItems: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!invoice) notFound();

  const taxConfig = await db.appSetting.findUnique({
    where: { key: "tax.config" },
  });

  const raw = (taxConfig?.value ?? null) as {
    gstRate?: number;
    qstRate?: number;
    gstNumber?: string;
    qstNumber?: string;
  } | null;

  const taxConfigValue = {
    gstRate: raw?.gstRate ?? 5,
    qstRate: raw?.qstRate ?? 9.975,
    gstNumber: raw?.gstNumber ?? "",
    qstNumber: raw?.qstNumber ?? "",
  };

  const invoiceData = {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    clientId: invoice.clientId,
    client: {
      id: invoice.client.id,
      name: invoice.client.name,
      email: invoice.client.email,
      phone: invoice.client.phone,
      address: invoice.client.address,
    },
    jobId: invoice.jobId,
    job: invoice.job
      ? {
          id: invoice.job.id,
          clientName: invoice.job.clientName,
          jobType: invoice.job.jobType,
          jobDate: invoice.job.jobDate?.toISOString() ?? null,
          location: invoice.job.location,
          description: invoice.job.description,
          price: invoice.job.price,
          status: invoice.job.status,
        }
      : null,
    subtotal: invoice.subtotal,
    gstAmount: invoice.gstAmount,
    qstAmount: invoice.qstAmount,
    discountAmount: invoice.discountAmount,
    totalAmount: invoice.totalAmount,
    notes: invoice.notes,
    dueDate: invoice.dueDate?.toISOString() ?? null,
    sentAt: invoice.sentAt?.toISOString() ?? null,
    paidAt: invoice.paidAt?.toISOString() ?? null,
    createdAt: invoice.createdAt.toISOString(),
    lineItems: invoice.lineItems.map((li) => ({
      id: li.id,
      description: li.description,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      amount: li.amount,
      sortOrder: li.sortOrder,
    })),
  };

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8 print:!h-auto print:!overflow-visible print:!p-0">
      <InvoiceDetailView invoice={invoiceData} taxConfig={taxConfigValue} />
    </div>
  );
}
