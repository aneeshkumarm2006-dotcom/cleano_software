/**
 * Invoice PDF generator. Mirrors the receipt-pdf shape but renders a
 * full invoice with bill-to, line items, GST/QST breakdown, total, and
 * the company tax IDs.
 */

import { db } from "@/lib/org-db";
import { formatDate } from "@/lib/timezone";
import { formatAddressLine, normalizeAddressKey } from "@/lib/client-address";
import { resolveDepositCredit } from "@/lib/booking-deposit";
import { taxRegistrationNumber } from "@/lib/tax";
import { getSetting } from "@/lib/settings";
import { getCurrentOrg } from "@/lib/org";
import { orgFromContext } from "@/lib/org-context";

const BRAND = "#008C9C";

export interface InvoicePdfData {
  invoiceNumber: string;
  status: string;
  issuedAt: string;
  dueDate: string | null;
  client: {
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
  };
  /**
   * Where the work was actually done (awerfixes.pdf item 2, round 3, stage 4).
   *
   * "Bill to" above stays the client's BILLING address — that is what it means,
   * and changing it would have been a different fix. This is a separate block,
   * because with several saved addresses per client the two genuinely differ:
   * an invoice for the office was printing whatever address the customer's most
   * recent home booking had last written to `Client.address`.
   *
   * Null when the invoice can't name ONE address — a consolidated invoice
   * covering jobs at two properties would be lying with either of them, so it
   * prints neither.
   */
  serviceAddress: string | null;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }>;
  subtotal: number;
  discountAmount: number;
  gstAmount: number;
  qstAmount: number;
  totalAmount: number;
  /**
   * Deposit already collected on the job this invoice bills, credited below the
   * total (Stage 11 / PDF #9: *"the final invoice applies the deposit toward the
   * confirmed total"*).
   *
   * Only ever set for a SINGLE-job invoice. A consolidated invoice covering
   * several bookings could carry several deposits, and crediting one of them
   * against a combined total would be arithmetic nobody could reconcile — so it
   * prints none, exactly as `serviceAddress` above prints no address when the
   * invoice cannot name one.
   */
  depositApplied: number;
  notes: string | null;
  brand: {
    name: string;
    tagline: string;
    gstNumber: string | null;
    qstNumber: string | null;
  };
}

export async function loadInvoiceData(
  invoiceId: string
): Promise<InvoicePdfData | null> {
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      client: true,
      // The job this invoice is for, plus the jobs its line items point at —
      // a consolidated invoice has no `jobId` of its own (item 2).
      job: {
        select: {
          location: true,
          aptNumber: true,
          // The job's OWN postal-code snapshot (item 2). Read first, below,
          // because an invoice must print the address as it was when the work
          // was booked — and because an imported or hand-typed job can carry a
          // postal code without ever having been linked to a saved address.
          postalCode: true,
          // Stage 11 — the deposit credit line below.
          depositPaid: true,
          depositAmount: true,
          clientAddress: { select: { city: true, postalCode: true } },
        },
      },
      lineItems: {
        orderBy: { sortOrder: "asc" },
        include: {
          jobLink: {
            select: {
              location: true,
              aptNumber: true,
              postalCode: true,
              clientAddress: { select: { city: true, postalCode: true } },
            },
          },
        },
      },
    },
  });
  if (!invoice) return null;

  // Resolve the ONE address this invoice serviced, or none. Line items are
  // consulted because a consolidated invoice links its jobs there rather than
  // at the top level; if they disagree, printing any single one would be wrong.
  const addressCandidates = [
    invoice.job,
    ...invoice.lineItems.map((li) => li.jobLink),
  ].filter((j): j is NonNullable<typeof j> => !!j?.location);

  const distinctAddresses = new Map<string, string>();
  for (const j of addressCandidates) {
    const line = formatAddressLine({
      address: j.location,
      aptNumber: j.aptNumber,
      city: j.clientAddress?.city ?? null,
      postalCode: j.postalCode ?? j.clientAddress?.postalCode ?? null,
    });
    if (line) distinctAddresses.set(normalizeAddressKey(j.location, j.aptNumber), line);
  }
  const serviceAddress =
    distinctAddresses.size === 1 ? [...distinctAddresses.values()][0] : null;

  // The registration numbers come from `tax.config`, which is what Settings →
  // Money → Tax actually writes.
  //
  // This used to read two standalone `gstNumber` / `qstNumber` AppSetting keys.
  // Those keys exist in NO workspace — checked all seven — so the PDF fell back
  // to empty and no invoice this app has ever produced carried a registration
  // number, including Montreal's, which has both saved correctly. A Canadian
  // business customer needs the supplier's GST number on the invoice to claim
  // their input tax credit, so an invoice without it is not just untidy.
  //
  // The legacy keys are still read as a fallback, in case an older workspace
  // somewhere does have them.
  const taxSetting = await db.appSetting
    .findFirst({ where: { key: "tax.config" } })
    .catch(() => null);
  const taxCfg = (taxSetting?.value ?? null) as {
    gstNumber?: unknown;
    qstNumber?: unknown;
  } | null;

  const legacy = async (key: string) => {
    const row = await db.appSetting.findFirst({ where: { key } }).catch(() => null);
    return row?.value;
  };

  const gstNumber =
    taxRegistrationNumber(taxCfg?.gstNumber) ??
    taxRegistrationNumber(await legacy("gstNumber"));
  const qstNumber =
    taxRegistrationNumber(taxCfg?.qstNumber) ??
    taxRegistrationNumber(await legacy("qstNumber"));

  // The company's own name, not the platform's. "Cleano" was typed in here as
  // a literal, so a second workspace's invoices went out headed with another
  // company's brand.
  //
  // Falls back to the workspace's own name rather than to "Cleano", because
  // four of the seven workspaces have never set `general.businessName` and the
  // platform workspace is not called Cleano at all. `orgFromContext` first:
  // this also runs from the email cron, outside any request.
  const businessName = await getSetting("general.businessName").catch(() => null);
  const orgName =
    orgFromContext()?.name ??
    (await getCurrentOrg().catch(() => null))?.name ??
    null;

  return {
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    issuedAt: invoice.createdAt.toISOString(),
    dueDate: invoice.dueDate?.toISOString() ?? null,
    client: {
      name: invoice.client.name,
      email: invoice.client.email,
      phone: invoice.client.phone,
      address: invoice.client.address,
    },
    serviceAddress,
    lineItems: invoice.lineItems.map((li) => ({
      description: li.description,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      amount: li.amount,
    })),
    subtotal: invoice.subtotal,
    discountAmount: invoice.discountAmount,
    gstAmount: invoice.gstAmount,
    qstAmount: invoice.qstAmount,
    totalAmount: invoice.totalAmount,
    // `invoice.job` is set only on a single-job invoice; a consolidated one links
    // its jobs through the line items instead and deliberately credits nothing.
    depositApplied: invoice.job ? resolveDepositCredit(invoice.job) : 0,
    notes: invoice.notes,
    brand: {
      name:
        (typeof businessName === "string" && businessName.trim()) ||
        orgName ||
        "Cleano",
      tagline: "Professional Cleaning Services",
      gstNumber,
      qstNumber,
    },
  };
}

export async function buildInvoicePdfBuffer(
  data: InvoicePdfData
): Promise<Buffer> {
  const { pdf, Document, Page, Text, View, StyleSheet } = await import(
    "@react-pdf/renderer"
  );
  const React = await import("react");
  const tint = (a: number) => `rgba(0,140,156, ${a})`;

  const styles = StyleSheet.create({
    page: {
      paddingTop: 48,
      paddingBottom: 48,
      paddingHorizontal: 48,
      fontSize: 10,
      fontFamily: "Helvetica",
      color: BRAND,
    },
    headerBand: {
      backgroundColor: BRAND,
      color: "#fff",
      padding: 24,
      flexDirection: "row",
      justifyContent: "space-between",
      borderRadius: 4,
      marginBottom: 24,
    },
    headerLeftTitle: { color: "#fff", fontSize: 22, fontFamily: "Helvetica-Bold" },
    headerLeftSub: { color: "#cfe4e7", fontSize: 9, marginTop: 4 },
    headerRightTitle: { color: "#fff", fontSize: 16, fontFamily: "Helvetica-Bold", textAlign: "right" },
    headerRightSub: { color: "#cfe4e7", fontSize: 8.5, textAlign: "right", marginTop: 2 },
    block: { marginBottom: 18 },
    label: { color: tint(0.6), fontSize: 9, marginBottom: 2 },
    value: { color: BRAND, fontSize: 11 },
    twoColRow: { flexDirection: "row", justifyContent: "space-between" },
    colHalf: { width: "48%" },
    sectionTitle: {
      fontSize: 9,
      color: tint(0.6),
      textTransform: "uppercase",
      marginBottom: 6,
      letterSpacing: 1,
    },
    tableHeader: {
      flexDirection: "row",
      paddingVertical: 6,
      borderBottomWidth: 1,
      borderBottomColor: BRAND,
      marginTop: 8,
    },
    th: { color: tint(0.6), fontSize: 9, textTransform: "uppercase" },
    row: {
      flexDirection: "row",
      paddingVertical: 5,
      borderBottomWidth: 0.5,
      borderBottomColor: tint(0.12),
    },
    cell: { color: BRAND, fontSize: 10 },
    totalRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 6,
      marginTop: 6,
      borderTopWidth: 1,
      borderTopColor: BRAND,
    },
    totalLabel: { fontSize: 12, color: BRAND, fontFamily: "Helvetica-Bold" },
    totalValue: { fontSize: 12, color: BRAND, fontFamily: "Helvetica-Bold" },
    notes: {
      marginTop: 18,
      padding: 12,
      backgroundColor: tint(0.05),
      borderRadius: 4,
      fontSize: 10,
      color: tint(0.7),
    },
    footer: {
      marginTop: 30,
      paddingTop: 14,
      borderTopWidth: 0.5,
      borderTopColor: tint(0.2),
      fontSize: 8,
      color: tint(0.5),
      textAlign: "center",
    },
  });

  const fmt = (n: number) => `$${n.toFixed(2)} CAD`;
  const el = React.createElement;

  // Invoices render on the host (UTC); without an explicit timezone a job dated
  // late evening printed the following day's date (Q9).
  const fmtDay = (iso: string | null) =>
    iso
      ? formatDate(iso, { month: "long", day: "numeric", year: "numeric" })
      : "—";

  const doc = el(
    Document,
    null,
    el(
      Page,
      { size: "LETTER", style: styles.page },
      el(
        View,
        { style: styles.headerBand },
        el(
          View,
          null,
          el(Text, { style: styles.headerLeftTitle }, "INVOICE"),
          el(Text, { style: styles.headerLeftSub }, data.invoiceNumber),
        ),
        el(
          View,
          null,
          el(Text, { style: styles.headerRightTitle }, data.brand.name),
          el(Text, { style: styles.headerRightSub }, data.brand.tagline),
          ...(data.brand.gstNumber
            ? [el(Text, { style: styles.headerRightSub }, `GST: ${data.brand.gstNumber}`)]
            : []),
          ...(data.brand.qstNumber
            ? [el(Text, { style: styles.headerRightSub }, `QST: ${data.brand.qstNumber}`)]
            : []),
        ),
      ),

      el(
        View,
        { style: [styles.block, styles.twoColRow] },
        el(
          View,
          { style: styles.colHalf },
          el(Text, { style: styles.sectionTitle }, "Bill to"),
          el(Text, { style: styles.value }, data.client.name),
          ...(data.client.address
            ? [el(Text, { style: [styles.value, { fontSize: 10 }] }, data.client.address)]
            : []),
          ...(data.client.email
            ? [el(Text, { style: [styles.value, { fontSize: 10 }] }, data.client.email)]
            : []),
          ...(data.client.phone
            ? [el(Text, { style: [styles.value, { fontSize: 10 }] }, data.client.phone)]
            : []),
        ),
        el(
          View,
          { style: [styles.colHalf, { alignItems: "flex-end" }] },
          el(Text, { style: styles.sectionTitle }, "Date issued"),
          el(Text, { style: styles.value }, fmtDay(data.issuedAt)),
          el(Text, { style: [styles.sectionTitle, { marginTop: 10 }] }, "Due date"),
          el(Text, { style: styles.value }, fmtDay(data.dueDate)),
        ),
      ),

      // Service address (item 2) — separate from "Bill to" above, which is the
      // billing address. Omitted entirely when the invoice covers jobs at more
      // than one address, rather than printing one of them and implying both.
      ...(data.serviceAddress
        ? [
            el(
              View,
              { style: styles.block },
              el(Text, { style: styles.sectionTitle }, "Service address"),
              el(Text, { style: [styles.value, { fontSize: 10 }] }, data.serviceAddress),
            ),
          ]
        : []),

      el(
        View,
        { style: styles.tableHeader },
        el(Text, { style: [styles.th, { flex: 3.4 }] }, "Description"),
        el(Text, { style: [styles.th, { flex: 0.6, textAlign: "right" }] }, "Qty"),
        el(Text, { style: [styles.th, { flex: 1, textAlign: "right" }] }, "Unit"),
        el(Text, { style: [styles.th, { flex: 1, textAlign: "right" }] }, "Amount"),
      ),
      ...data.lineItems.map((li, idx) =>
        el(
          View,
          { style: styles.row, key: `li${idx}` },
          el(Text, { style: [styles.cell, { flex: 3.4 }] }, li.description),
          el(Text, { style: [styles.cell, { flex: 0.6, textAlign: "right" }] }, String(li.quantity)),
          el(Text, { style: [styles.cell, { flex: 1, textAlign: "right" }] }, fmt(li.unitPrice)),
          el(Text, { style: [styles.cell, { flex: 1, textAlign: "right" }] }, fmt(li.amount)),
        ),
      ),

      el(
        View,
        { style: [{ marginTop: 14 }] },
        el(
          View,
          { style: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 } },
          el(Text, { style: styles.value }, "Subtotal"),
          el(Text, { style: styles.value }, fmt(data.subtotal)),
        ),
        ...(data.discountAmount > 0
          ? [
              el(
                View,
                { style: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 } },
                el(Text, { style: styles.value }, "Discount"),
                el(Text, { style: styles.value }, `-${fmt(data.discountAmount)}`),
              ),
            ]
          : []),
        ...(data.gstAmount > 0
          ? [
              el(
                View,
                { style: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 } },
                el(Text, { style: styles.value }, "GST"),
                el(Text, { style: styles.value }, fmt(data.gstAmount)),
              ),
            ]
          : []),
        ...(data.qstAmount > 0
          ? [
              el(
                View,
                { style: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 } },
                el(Text, { style: styles.value }, "QST"),
                el(Text, { style: styles.value }, fmt(data.qstAmount)),
              ),
            ]
          : []),
        el(
          View,
          { style: styles.totalRow },
          el(Text, { style: styles.totalLabel }, "Total"),
          el(Text, { style: styles.totalValue }, fmt(data.totalAmount)),
        ),
        // Deposit credit (Stage 11 / PDF #9). Below the total, like the receipt:
        // the invoice states what the work is worth, then what has been collected
        // against it. Rolling it into the subtotal would understate the sale and
        // the tax charged on it.
        ...(data.depositApplied > 0
          ? [
              el(
                View,
                { style: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 } },
                el(Text, { style: styles.value }, "Deposit applied"),
                el(Text, { style: styles.value }, `-${fmt(data.depositApplied)}`),
              ),
              el(
                View,
                { style: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 } },
                el(Text, { style: styles.value }, "Balance due"),
                el(
                  Text,
                  { style: styles.value },
                  fmt(Math.max(0, data.totalAmount - data.depositApplied)),
                ),
              ),
            ]
          : []),
      ),

      ...(data.notes
        ? [el(View, { style: styles.notes }, el(Text, null, data.notes))]
        : []),

      el(
        Text,
        { style: styles.footer },
        `Thank you for choosing ${data.brand.name}. Questions? Reply to this email.`,
      ),
    ),
  );

  const stream = await pdf(doc).toBuffer();
  return await streamToBuffer(stream);
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}
