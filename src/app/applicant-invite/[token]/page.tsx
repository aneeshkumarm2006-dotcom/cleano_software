import { db } from "@/db";
import SetPasswordForm from "./SetPasswordForm";
import SplitShell, { BRAND_IMAGES } from "@/components/customer/SplitShell";
import { Banner } from "@/components/customer/Field";

export default async function ApplicantInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const row = await db.applicantInviteToken.findUnique({
    where: { token },
    select: {
      usedAt: true,
      expiresAt: true,
      user: { select: { name: true, email: true } },
    },
  });

  let invalidReason: string | null = null;
  if (!row) invalidReason = "This link is not valid.";
  else if (row.usedAt)
    invalidReason =
      "This link has already been used. Ask your contact for a new invite.";
  else if (row.expiresAt < new Date())
    invalidReason =
      "This link has expired. Ask your contact to resend the invite.";

  const firstName = row?.user.name?.split(" ")[0];

  return (
    <SplitShell
      image={BRAND_IMAGES.setup}
      quoteHtml={"Welcome to<br/>your <em>applicant<br/>portal.</em>"}
      quoteSub="Set a password to track your application and complete onboarding steps."
      badge="Applicant portal">
      <header style={{ marginBottom: 36 }}>
        <p className="cl-eyebrow" style={{ marginBottom: 12 }}>
          {invalidReason ? "Invite link" : `Hi ${firstName},`}
        </p>
        <h1 className="cl-display">
          {invalidReason ? (
            "Set your password"
          ) : (
            <>
              Set your
              <br />
              <em>password.</em>
            </>
          )}
        </h1>
        {!invalidReason && row ? (
          <p className="cl-subtitle">
            Create a password for {row.user.email} to finish setting up your
            applicant portal account.
          </p>
        ) : null}
      </header>

      {invalidReason ? (
        <Banner kind="error">{invalidReason}</Banner>
      ) : (
        <SetPasswordForm token={token} />
      )}
    </SplitShell>
  );
}
