/**
 * Shown instead of the application when a workspace cannot be used.
 *
 * Two cases, deliberately worded differently:
 *
 *   suspended  -- the workspace exists but is locked (non-payment, or an admin
 *                 action). Their data is untouched and the way back is billing.
 *   not-found  -- nothing is registered at this subdomain. It says nothing about
 *                 which workspaces do exist, so the page cannot be used to probe
 *                 for customer names.
 */
export default function OrgUnavailable({
  reason,
  name,
}: {
  reason: "suspended" | "cancelled" | "pending" | "not-found";
  name?: string;
}) {
  const copy = {
    suspended: {
      title: "This workspace is on hold",
      body: `${name ?? "This account"} is temporarily locked while a billing issue is resolved. Nothing has been deleted — everything is exactly where you left it, and access returns as soon as billing is settled.`,
      action: "Contact billing",
    },
    cancelled: {
      title: "This workspace is closed",
      body: `${name ?? "This account"} is no longer active. If this is unexpected, or you would like to reopen it, get in touch and we will help.`,
      action: "Contact us",
    },
    pending: {
      title: "This workspace is being set up",
      body: "We are still preparing this account. It will be ready shortly — you will get an email the moment it is.",
      action: "Contact us",
    },
    "not-found": {
      title: "No workspace here",
      body: "There is no account at this address. Check the web address, or head to the main site to get started.",
      action: "Go to Awer",
    },
  }[reason];

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "#f5f2ed",
        color: "#00424a",
      }}
    >
      <div style={{ maxWidth: 460, textAlign: "center" }}>
        <p
          style={{
            margin: "0 0 24px",
            fontSize: 13,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            opacity: 0.55,
          }}
        >
          Awer
        </p>
        <h1 style={{ margin: "0 0 12px", fontSize: 26, fontWeight: 700 }}>
          {copy.title}
        </h1>
        <p style={{ margin: "0 0 28px", fontSize: 15, lineHeight: 1.6, opacity: 0.8 }}>
          {copy.body}
        </p>
        <a
          href={
            reason === "not-found"
              ? "https://www.useawer.com"
              : "mailto:billing@useawer.com"
          }
          style={{
            display: "inline-block",
            padding: "12px 28px",
            background: "#00424a",
            color: "#fff",
            borderRadius: 8,
            textDecoration: "none",
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          {copy.action}
        </a>
      </div>
    </main>
  );
}
