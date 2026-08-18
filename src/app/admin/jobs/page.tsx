import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  SAVED_ADDRESS_ORDER,
  SAVED_ADDRESS_SELECT,
} from "@/lib/client-address-store";
import JobsPageClient from "./JobsPageClient";
import { getBookingConfig } from "../../(book)/actions/getBookingConfig";
import { getTaxRates } from "@/lib/tax.server";
import { getServicePricingConfig } from "@/lib/booking-pricing";
import { getServiceCatalog } from "@/lib/service-catalog.server";
import { serviceOptions } from "@/lib/service-catalog";
import { activeSubtotal } from "@/lib/job-money";

type SearchParams = Promise<{
  [key: string]: string | string[] | undefined;
}>;

// Allow bulk CSV import (processed by the importCsv server action) enough time.
export const maxDuration = 60;

export default async function JobsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  const isAdmin =
    (session.user as any).role === "ADMIN" ||
    (session.user as any).role === "OWNER";

  const params = await searchParams;
  const search = (params.search as string) || "";
  const status = (params.status as string) || "all";
  const payment = (params.payment as string) || "all";
  const subTab = (params.subTab as string) || "all";
  const page = Number(params.page) || 1;
  const rowsPerPage = Number(params.rowsPerPage) || 10;
  const archived = params.archived === "1";

  const baseWhere: any = {};
  if (!isAdmin) {
    baseWhere.employeeId = session.user.id;
  }

  // The list respects the Active/Archived toggle via `deletedAt`. Stats are NOT
  // computed here any more: they used to be four server counts over ALL active
  // jobs while the table showed a CLIENT-side filtered subset, so changing a
  // date/client/cleaner filter moved the table but froze the cards. JobsView now
  // derives every card from the same `filteredJobs` list it renders, using the
  // canonical predicates in src/lib/metrics-shared.
  const listWhere = {
    ...baseWhere,
    deletedAt: archived ? { not: null } : null,
  };

  const allJobs = await db.job.findMany({
    where: listWhere,
    // Lean select — only the fields the list rows + stat cards actually read.
    // The old query pulled the FULL employee and client objects (never used)
    // plus full user + product records for every one of ~800 jobs, which was a
    // big part of why this page was slow. Behaviour is unchanged.
    select: {
      id: true,
      clientName: true,
      clientId: true,
      location: true,
      aptNumber: true,
      postalCode: true,
      clientAddressId: true,
      description: true,
      jobType: true,
      jobDate: true,
      startTime: true,
      endTime: true,
      status: true,
      price: true,
      employeePay: true,
      employeePayIsManual: true,
      totalTip: true,
      parking: true,
      notes: true,
      paymentReceived: true,
      invoiceSent: true,
      paymentType: true,
      isCashJob: true,
      taxExempt: true,
      usesFixedPrice: true,
      discountAmount: true,
      // The modal renders a Reason control and posts it on EVERY save, so a row
      // handed over without it arrives blank and the save writes that blank
      // back — which is how discounts lost their "Courtesy"/"Loyalty" reason
      // just by being edited from this list. Same rule as the Stage 8-10
      // columns above (§14.3.a).
      discountReason: true,
      refundedAmount: true,
      deletedAt: true,
      // Feed the edit modal's money basis + live total preview.
      bookingSource: true,
      pricingMode: true,
      subtotalAmount: true,
      // The pay model and the BILLING model, both of which the edit modal owns
      // a control for. A control that is rendered but not prefilled posts its
      // default and silently resets the job — which is why these have to travel
      // with the row: without `payType`/`hourlyRate` an hourly-PAID job edited
      // from this list reverted to PERCENTAGE, and Stage 8's four columns would
      // have done the same to an hourly-BILLED one.
      payType: true,
      hourlyRate: true,
      billingType: true,
      billedHourlyRate: true,
      billedEstimatedHours: true,
      billedActualHours: true,
      bedCount: true,
      bathCount: true,
      halfBathCount: true,
      // Same reason as the four billing columns above: the edit modal renders a
      // property-type control, so a row that arrived without this would post a
      // blank and quietly erase the job's type on a quick edit (Stage 9).
      propertyType: true,
      checklistTemplateId: true,
      cleaners: { select: { id: true, name: true } },
      addOns: { select: { id: true, name: true, price: true, quantity: true } },
      productUsage: { select: { quantity: true, product: { select: { costPerUnit: true } } } },
    },
    // jobDate is nullable — push null-date jobs after dated ones instead of
    // letting them float to the top, then break ties on the real start instant.
    orderBy: [
      { jobDate: { sort: "desc", nulls: "last" } },
      { startTime: "desc" },
    ],
  });

  const users = await db.user.findMany({
    where: { role: { not: "CLIENT" } },
    orderBy: { name: "asc" },
    // allowedServiceCategories drives JobModal's category advisory (item 3).
    select: {
      id: true,
      name: true,
      email: true,
      allowedServiceCategories: true,
    },
  });

  // Assignable cleaners for the bulk "Assign cleaner" picker.
  const cleaners = await db.user.findMany({
    where: { role: { in: ["EMPLOYEE", "FIELD_LEAD"] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });

  const clients = await db.client.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      // Fills the job form's Phone field for a linked client (item 4).
      phone: true,
      address: true,
      aptNumber: true,
      discountPercent: true,
      defaultPaymentMethodId: true,
      // The saved address book, so JobModal can offer the dropdown (item 2).
      addresses: {
        orderBy: SAVED_ADDRESS_ORDER,
        select: SAVED_ADDRESS_SELECT,
      },
    },
  });

  // Add-ons configured in Settings → Pricing Rules, offered as quick-add chips
  // in the job form so staff don't have to retype them.
  const { addOns: addOnCatalog } = await getBookingConfig();

  // The modal's live total preview must quote the SAME rates saveJob will use.
  const taxRates = await getTaxRates();

  // Move-in/out per-sq-ft rates, so the job modal can show the derived price
  // for square-foot-priced services (item 8).
  const sqftRates = (await getServicePricingConfig()).moveInOut;

  // THE service list (item 20) — Settings → Job Types drives the form picker
  // and the filter, so they can never drift apart.
  const serviceCatalog = await getServiceCatalog();
  const serviceOptionList = serviceOptions(serviceCatalog);

  const jobsData = allJobs.map((job) => {
    const productCost = job.productUsage.reduce(
      (sum, u) => sum + u.quantity * u.product.costPerUnit,
      0
    );
    // Fix 3: the profit % column is a share of what the job is actually worth
    // — base + add-ons, or the override total — not of the base line alone.
    // On the $128/$186 grout job the old denominator made a 46%-labour job
    // look like a loss.
    const revenue = activeSubtotal(job);
    // Stage 4b.3 / decision D3 — parking is NOT a company cost. It is money the
    // customer funds and the crew is handed (see JobPayShare.parking), so
    // subtracting it here charged the company for a disbursement it never made
    // and dragged the profit % on every job that had one.
    const costs = (job.employeePay || 0) + productCost;
    const profit = revenue - costs;
    const profitPct = revenue > 0 ? (profit / revenue) * 100 : 0;

    const timeSpentMs =
      job.endTime && job.startTime
        ? new Date(job.endTime).getTime() - new Date(job.startTime).getTime()
        : 0;

    return {
      id: job.id,
      clientName: job.clientName,
      clientId: job.clientId,
      location: job.location,
      aptNumber: job.aptNumber,
      postalCode: job.postalCode,
      clientAddressId: job.clientAddressId,
      description: job.description,
      jobType: job.jobType,
      jobDate: job.jobDate?.toISOString() || null,
      startTime: job.startTime.toISOString(),
      endTime: job.endTime?.toISOString() || null,
      status: job.status,
      price: job.price,
      employeePay: job.employeePay,
      employeePayIsManual: job.employeePayIsManual,
      totalTip: job.totalTip,
      parking: job.parking,
      notes: job.notes,
      paymentReceived: job.paymentReceived,
      invoiceSent: job.invoiceSent,
      paymentType: job.paymentType,
      isCashJob: job.isCashJob,
      taxExempt: job.taxExempt,
      usesFixedPrice: job.usesFixedPrice,
      discountAmount: job.discountAmount,
      discountReason: job.discountReason,
      // Needed client-side by the canonical revenue predicate (metrics-shared):
      // revenue = price − discount − refund, and only for non-archived rows.
      refundedAmount: job.refundedAmount,
      deletedAt: job.deletedAt?.toISOString() || null,
      bedCount: job.bedCount,
      bathCount: job.bathCount,
      halfBathCount: job.halfBathCount,
      propertyType: job.propertyType,
      checklistTemplateId: job.checklistTemplateId,
      // The pay model and the billing model. Both were already in the `select`
      // above and in JobsPageClient's `Job` type, each with a comment saying a
      // row must not arrive without them — but neither was ever copied HERE, so
      // every modal opened from this list read `undefined` and fell back to its
      // default. Because the modal owns these controls it posts them on every
      // save, so a quick edit from this list silently rewrote the job: an
      // hourly-BILLED job became FLAT with its rate and hours nulled (and its
      // price with them, since price mirrors rate × hours), and an hourly-PAID
      // job reverted to PERCENTAGE. Found by Stage 14.3's two-save-paths pass;
      // `verify-stage14-regression.ts` now pins the whole select→map→type chain.
      payType: job.payType,
      hourlyRate: job.hourlyRate,
      billingType: job.billingType,
      billedHourlyRate: job.billedHourlyRate,
      billedEstimatedHours: job.billedEstimatedHours,
      billedActualHours: job.billedActualHours,
      profit,
      profitPct,
      timeSpentMs,
      cleaners: job.cleaners.map((c) => ({ id: c.id, name: c.name })),
      addOns: job.addOns.map((a) => ({
        id: a.id,
        name: a.name,
        price: a.price,
        quantity: a.quantity,
      })),
      // The edit modal needs these to know whether this job's add-ons are
      // already inside its service total (FINAL_PRICE) or add to it (ITEMIZED),
      // and to preselect the mode control.
      bookingSource: job.bookingSource,
      pricingMode: job.pricingMode,
      subtotalAmount: job.subtotalAmount,
    };
  });

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <JobsPageClient
        initialJobs={jobsData}
        initialSearch={search}
        initialStatus={status}
        initialPayment={payment}
        initialSubTab={subTab}
        initialPage={page}
        initialRowsPerPage={rowsPerPage}
        users={users}
        cleaners={cleaners}
        clients={clients}
        addOnCatalog={addOnCatalog}
        taxRates={taxRates}
        serviceOptions={serviceOptionList}
        sqftRates={sqftRates}
        isAdmin={isAdmin}
        archived={archived}
      />
    </div>
  );
}
