import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/org-db";
import { storeDateKey } from "@/lib/timezone";
import InvoicesPageClient from "./InvoicesPageClient";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    redirect("/admin/dashboard");
  }

  const params = await searchParams;
  const archived = params.archived === "1";

  const [invoices, clients, taxConfig] = await Promise.all([
    db.invoice.findMany({
      where: { deletedAt: archived ? { not: null } : null },
      orderBy: { createdAt: "desc" },
      include: {
        client: { select: { id: true, name: true, email: true, phone: true, address: true } },
        job: { select: { id: true, clientName: true, jobType: true, jobDate: true } },
        lineItems: { orderBy: { sortOrder: "asc" } },
      },
    }),
    db.client.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        discountPercent: true,
      },
      orderBy: { name: "asc" },
    }),
    db.appSetting.findUnique({ where: { key: "tax.config" } }),
  ]);

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

  const invoiceRows = invoices.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    status: inv.status,
    clientId: inv.clientId,
    clientName: inv.client.name,
    clientEmail: inv.client.email,
    clientPhone: inv.client.phone,
    clientAddress: inv.client.address,
    jobId: inv.jobId,
    jobClientName: inv.job?.clientName ?? null,
    jobType: inv.job?.jobType ?? null,
    jobDate: inv.job?.jobDate?.toISOString() ?? null,
    subtotal: inv.subtotal,
    gstAmount: inv.gstAmount,
    qstAmount: inv.qstAmount,
    discountAmount: inv.discountAmount,
    totalAmount: inv.totalAmount,
    notes: inv.notes,
    dueDate: inv.dueDate?.toISOString() ?? null,
    sentAt: inv.sentAt?.toISOString() ?? null,
    paidAt: inv.paidAt?.toISOString() ?? null,
    createdAt: inv.createdAt.toISOString(),
    lineItems: inv.lineItems.map((li) => ({
      id: li.id,
      description: li.description,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      amount: li.amount,
      sortOrder: li.sortOrder,
    })),
  }));

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <InvoicesPageClient
        invoices={invoiceRows}
        clients={clients}
        taxConfig={taxConfigValue}
        archived={archived}
        // "Overdue" is derived, not stored (nothing in the app ever writes that
        // status). The comparison day is resolved here, once, in the STORE
        // timezone — not from the browser's clock and not from the host's,
        // which is UTC and would call a Montréal invoice late four hours early.
        todayKey={storeDateKey()}
      />
    </div>
  );
}
