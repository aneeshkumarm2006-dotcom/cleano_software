import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { getSettings } from "@/lib/settings";
import AccountForm from "./AccountForm";
import PaymentMethods from "./PaymentMethods";
import SavedAddresses from "./SavedAddresses";
import {
  SAVED_ADDRESS_ORDER,
  SAVED_ADDRESS_SELECT,
} from "@/lib/client-address-store";

export default async function AccountPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const email = session.user.email?.toLowerCase();
  const client = email
    ? await db.client.findFirst({ where: { email } })
    : null;

  if (!client) {
    return (
      <div className="cl-tile cl-tile-pad-lg" style={{ textAlign: "center" }}>
        <p className="cl-subtitle">No client record linked to {email}.</p>
      </div>
    );
  }

  // The referral amounts are read here rather than hardcoded in the card copy:
  // these are the SAME keys submitBooking already pays out on, so what the
  // customer is promised and what they actually get can no longer drift.
  const {
    "general.businessEmail": businessEmail,
    "general.businessPhone": businessPhone,
    "customer.newClientReferralDiscountUsd": referralDiscount,
    "customer.referrerCreditUsd": referrerCredit,
  } = await getSettings([
    "general.businessEmail",
    "general.businessPhone",
    "customer.newClientReferralDiscountUsd",
    "customer.referrerCreditUsd",
  ]);

  // The saved address book (item 2). Replaces the single "Default address"
  // textbox that used to live in AccountForm.
  const addresses = await db.clientAddress.findMany({
    where: { clientId: client.id },
    orderBy: SAVED_ADDRESS_ORDER,
    select: SAVED_ADDRESS_SELECT,
  });

  return (
    <>
      <AccountForm
        initial={{
          name: client.name,
          email: client.email ?? email ?? "",
          phone: client.phone ?? "",
          referralCode: client.referralCode,
          referralCredit: client.referralCredit,
        }}
        businessEmail={businessEmail}
        businessPhone={businessPhone}
        referralDiscount={referralDiscount}
        referrerCredit={referrerCredit}
      />
      <SavedAddresses addresses={addresses} />
      {/* Payment methods subsection. Loads its own data client-side so the
          profile form above keeps rendering if Stripe is unreachable. */}
      <PaymentMethods />
    </>
  );
}
