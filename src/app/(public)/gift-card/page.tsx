import GiftCardPurchaseClient from "./GiftCardPurchaseClient";
import { GIFT_CARD_COVERS, MIN_JOB_PRICE_USD } from "@/lib/gift-cards/covers";
import { getSetting } from "@/lib/settings";

export const metadata = {
  title: "Buy a Gift Card · Cleano",
  description:
    "Send a Cleano cleaning service gift card to someone you appreciate.",
};

export default async function GiftCardPurchasePage() {
  const tiers = await getSetting("payments.giftCardTiers");
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #f7faf9 0%, #ffffff 100%)",
        padding: "48px 16px",
      }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <header style={{ marginBottom: 28, textAlign: "center" }}>
          <div
            style={{
              fontSize: 12,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#005F6A",
              fontWeight: 700,
            }}>
            Cleano gift cards
          </div>
          <h1
            style={{
              marginTop: 8,
              fontSize: "clamp(32px, 5vw, 48px)",
              lineHeight: 1.1,
              color: "#0a1f24",
              fontWeight: 700,
            }}>
            Send the gift of a clean home
          </h1>
          <p
            style={{
              marginTop: 12,
              fontSize: 15,
              color: "#3a5a62",
              lineHeight: 1.5,
            }}>
            A Cleano gift card adds credit to the recipient's account and
            auto-applies the next time they book a cleaning. Our minimum
            job price is <strong>${MIN_JOB_PRICE_USD}</strong>, so pick a
            value that comfortably covers a service for them.
          </p>
        </header>

        <GiftCardPurchaseClient
          tiers={tiers}
          covers={GIFT_CARD_COVERS}
          minJobPrice={MIN_JOB_PRICE_USD}
        />
      </div>
    </div>
  );
}
