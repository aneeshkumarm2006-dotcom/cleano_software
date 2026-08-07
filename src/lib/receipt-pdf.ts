import { db } from "@/db";
import { addOnLineLabel, computeJobMoney, type AddOnLine } from "@/lib/job-money";
import { getTaxRates } from "@/lib/tax.server";

const BRAND = "#008C9C";

export interface ReceiptData {
  jobId: string;
  jobNumber: number;
  jobDate: string;
  clientName: string;
  clientEmail: string | null;
  address: string | null;
  serviceType: string | null;
  bedCount: number | null;
  bathCount: number | null;
  basePrice: number;
  addOns: AddOnLine[];
  subtotal: number;
  gstAmount: number;
  qstAmount: number;
  totalAmount: number;
  refundedAmount: number;
  paidAt: string | null;
}

export async function loadReceiptData(jobId: string): Promise<ReceiptData | null> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
      client: { select: { name: true, email: true } },
      addOns: { select: { name: true, price: true, quantity: true } },
    },
  });
  if (!job) return null;

  // One helper decides where this job's add-ons sit relative to its subtotal —
  // inside it for a web booking or an import, on top of it for an admin job.
  // Reading `job.price` as the total was correct under web semantics and wrong
  // on every admin job, where `price` is the PRE-tax figure and the receipt
  // therefore printed a total that excluded the tax the customer was charged.
  const money = computeJobMoney(job, await getTaxRates());

  return {
    jobId: job.id,
    jobNumber: job.jobNumber,
    jobDate: (job.jobDate ?? job.startTime).toISOString(),
    clientName: job.client?.name ?? job.clientName,
    clientEmail: job.client?.email ?? null,
    address: job.location,
    serviceType: job.jobType,
    bedCount: job.bedCount,
    bathCount: job.bathCount,
    basePrice: money.basePrice,
    addOns: money.addOnLines,
    subtotal: money.subtotalAmount,
    gstAmount: money.gstAmount,
    qstAmount: money.qstAmount,
    totalAmount: money.totalAmount,
    refundedAmount: job.refundedAmount,
    paidAt: job.paidAt?.toISOString() ?? null,
  };
}

export async function buildReceiptPdfBuffer(
  data: ReceiptData
): Promise<Buffer> {
  const { pdf, Document, Page, Text, View, StyleSheet } = await import(
    "@react-pdf/renderer"
  );
  // React.createElement avoids needing JSX in this .ts file.
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
    headerRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-end",
      marginBottom: 24,
      paddingBottom: 16,
      borderBottomWidth: 1,
      borderBottomColor: tint(0.2),
    },
    brand: { fontSize: 24, color: BRAND, fontFamily: "Helvetica-Bold" },
    subtitle: { fontSize: 9, color: tint(0.6), marginTop: 2 },
    title: { fontSize: 16, color: BRAND, textAlign: "right" },
    sectionTitle: {
      fontSize: 9,
      color: tint(0.6),
      textTransform: "uppercase",
      marginBottom: 6,
    },
    section: { marginBottom: 18 },
    sectionRow: { flexDirection: "row" },
    sectionCol: { flex: 1 },
    label: { color: tint(0.6), fontSize: 9, marginBottom: 2 },
    value: { color: BRAND, fontSize: 11 },
    lineItemRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 5,
      borderBottomWidth: 0.5,
      borderBottomColor: tint(0.12),
    },
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
    footer: {
      marginTop: 36,
      paddingTop: 16,
      borderTopWidth: 0.5,
      borderTopColor: tint(0.2),
      fontSize: 8,
      color: tint(0.5),
      textAlign: "center",
    },
    refundBanner: {
      backgroundColor: "rgba(220, 38, 38, 0.08)",
      padding: 10,
      borderRadius: 6,
      marginBottom: 18,
    },
    refundText: {
      fontSize: 10,
      color: "#991B1B",
    },
  });

  const fmt = (n: number) => `$${n.toFixed(2)} CAD`;

  const doc = React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "LETTER", style: styles.page },
      // Header
      React.createElement(
        View,
        { style: styles.headerRow },
        React.createElement(
          View,
          null,
          React.createElement(Text, { style: styles.brand }, "Cleano"),
          React.createElement(
            Text,
            { style: styles.subtitle },
            "Professional cleaning services · Montreal"
          )
        ),
        React.createElement(
          View,
          null,
          React.createElement(Text, { style: styles.title }, "Receipt"),
          React.createElement(
            Text,
            { style: styles.subtitle },
            `#${data.jobNumber}`
          ),
          React.createElement(
            Text,
            { style: styles.subtitle },
            new Date(data.paidAt ?? data.jobDate).toLocaleDateString()
          )
        )
      ),

      // Refund banner if applicable
      data.refundedAmount > 0
        ? React.createElement(
            View,
            { style: styles.refundBanner },
            React.createElement(
              Text,
              { style: styles.refundText },
              `Refund issued: ${fmt(data.refundedAmount)}`
            )
          )
        : null,

      // Client + service info
      React.createElement(
        View,
        { style: styles.section },
        React.createElement(
          View,
          { style: styles.sectionRow },
          React.createElement(
            View,
            { style: styles.sectionCol },
            React.createElement(Text, { style: styles.sectionTitle }, "Billed to"),
            React.createElement(Text, { style: styles.value }, data.clientName),
            data.clientEmail
              ? React.createElement(
                  Text,
                  { style: styles.subtitle },
                  data.clientEmail
                )
              : null,
            data.address
              ? React.createElement(
                  Text,
                  { style: styles.subtitle },
                  data.address
                )
              : null
          ),
          React.createElement(
            View,
            { style: styles.sectionCol },
            React.createElement(Text, { style: styles.sectionTitle }, "Service"),
            React.createElement(
              Text,
              { style: styles.value },
              data.serviceType ?? "Cleaning"
            ),
            React.createElement(
              Text,
              { style: styles.subtitle },
              `${data.bedCount ?? "?"} bed · ${data.bathCount ?? "?"} bath`
            ),
            React.createElement(
              Text,
              { style: styles.subtitle },
              `Service date: ${new Date(data.jobDate).toLocaleDateString()}`
            )
          )
        )
      ),

      // Line items
      React.createElement(Text, { style: styles.sectionTitle }, "Charges"),
      React.createElement(
        View,
        { style: styles.lineItemRow },
        React.createElement(Text, null, "Base service"),
        React.createElement(Text, null, fmt(data.basePrice))
      ),
      ...data.addOns.map((a, i) =>
        React.createElement(
          View,
          { key: `ao-${i}`, style: styles.lineItemRow },
          React.createElement(Text, null, addOnLineLabel(a)),
          React.createElement(Text, null, fmt(a.lineTotal))
        )
      ),
      React.createElement(
        View,
        { style: styles.lineItemRow },
        React.createElement(Text, null, "Subtotal"),
        React.createElement(Text, null, fmt(data.subtotal))
      ),
      React.createElement(
        View,
        { style: styles.lineItemRow },
        React.createElement(Text, null, "GST (5%)"),
        React.createElement(Text, null, fmt(data.gstAmount))
      ),
      React.createElement(
        View,
        { style: styles.lineItemRow },
        React.createElement(Text, null, "QST (9.975%)"),
        React.createElement(Text, null, fmt(data.qstAmount))
      ),
      React.createElement(
        View,
        { style: styles.totalRow },
        React.createElement(Text, { style: styles.totalLabel }, "Total"),
        React.createElement(
          Text,
          { style: styles.totalValue },
          fmt(data.totalAmount)
        )
      ),

      // Footer
      React.createElement(
        Text,
        { style: styles.footer },
        "Thank you for choosing Cleano. Questions? hello@cleano.example"
      )
    )
  );

  // Render to Node.js Buffer. The @react-pdf/renderer API returns a stream
  // we collect into a buffer.
  const stream = await pdf(doc as never).toBuffer();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}
