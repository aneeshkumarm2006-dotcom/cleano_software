import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { getSettings } from "@/lib/settings";
import AccountForm from "./AccountForm";
import PaymentMethods from "./PaymentMethods";

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

  const {
    "general.businessEmail": businessEmail,
    "general.businessPhone": businessPhone,
  } = await getSettings(["general.businessEmail", "general.businessPhone"]);

  return (
    <>
      <AccountForm
        initial={{
          name: client.name,
          email: client.email ?? email ?? "",
          phone: client.phone ?? "",
          address: client.address ?? "",
          referralCode: client.referralCode,
          referralCredit: client.referralCredit,
        }}
        businessEmail={businessEmail}
        businessPhone={businessPhone}
      />
      {/* Payment methods subsection. Loads its own data client-side so the
          profile form above keeps rendering if Stripe is unreachable. */}
      <PaymentMethods />
    </>
  );
}
