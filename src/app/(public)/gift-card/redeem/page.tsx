import GiftCardRedeemClient from "./GiftCardRedeemClient";

export const metadata = {
  title: "Redeem a Gift Card · Cleano",
};

export default async function GiftCardRedeemPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const params = await searchParams;
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #f7faf9 0%, #ffffff 100%)",
        padding: "48px 16px",
      }}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <header style={{ marginBottom: 28, textAlign: "center" }}>
          <div
            style={{
              fontSize: 12,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#008C9C",
              fontWeight: 700,
            }}>
            Cleano gift cards
          </div>
          <h1
            style={{
              marginTop: 8,
              fontSize: "clamp(28px, 4.5vw, 40px)",
              lineHeight: 1.1,
              color: "#0a1f24",
              fontWeight: 700,
            }}>
            Redeem your code
          </h1>
          <p style={{ marginTop: 12, fontSize: 14, color: "#3a5a62", lineHeight: 1.5 }}>
            Sign in to your Cleano customer account, paste the gift card code,
            and we'll add the credit to your account. It will auto-apply the
            next time you book.
          </p>
        </header>

        <GiftCardRedeemClient initialCode={params.code ?? ""} />
      </div>
    </div>
  );
}
