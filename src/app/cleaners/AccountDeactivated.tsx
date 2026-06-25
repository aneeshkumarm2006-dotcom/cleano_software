/**
 * Full-screen notice shown to a deactivated cleaner (User.isActive = false)
 * in place of the app. Message is the configurable provider.deactivatedMessage.
 */
export default function AccountDeactivated({
  message,
  signOutAction,
}: {
  message: string;
  signOutAction: () => void;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#f7faf9",
      }}>
      <div
        style={{
          maxWidth: 440,
          textAlign: "center",
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 16,
          padding: 32,
        }}>
        <h1
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "#0a1f24",
            marginBottom: 12,
          }}>
          Account unavailable
        </h1>
        <p
          style={{
            fontSize: 14,
            color: "#3a5a62",
            lineHeight: 1.6,
            marginBottom: 20,
          }}>
          {message}
        </p>
        <form action={signOutAction}>
          <button
            type="submit"
            style={{
              background: "#008C9C",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}>
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
