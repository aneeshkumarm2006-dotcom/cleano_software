import { getPublishedFaqs, type FaqLang } from "@/lib/faq";
import FaqAccordion from "@/components/FaqAccordion";

// Content is admin-editable, so render per request (not frozen at build).
export const dynamic = "force-dynamic";

export const metadata = {
  title: "FAQ · Cleano",
  description: "Frequently asked questions about Cleano cleaning services.",
};

export default async function FaqPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  // The app has no locale routing, so French lives on a query parameter and a
  // switch. Anything that isn't "fr" is English — an unknown value must not
  // produce a third, empty language.
  const { lang: rawLang } = await searchParams;
  const lang: FaqLang = rawLang === "fr" ? "fr" : "en";

  // PUBLIC + BOTH only — an entry marked "customer platform only" must not
  // appear on the marketing site (CLN-P1-4-10).
  const groups = await getPublishedFaqs("public", lang);

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
              color: "#008C9C",
              fontWeight: 700,
            }}>
            Cleano
          </div>
          <h1
            style={{
              marginTop: 8,
              fontSize: "clamp(28px, 5vw, 44px)",
              lineHeight: 1.1,
              color: "#0a1f24",
              fontWeight: 700,
            }}>
            {lang === "fr"
              ? "Questions fréquemment posées"
              : "Frequently asked questions"}
          </h1>
        </header>

        {/* Search, categories and the language switch are shared with the
            in-portal /help page so the two surfaces can't drift. Filtering is
            client-side over this list. */}
        <FaqAccordion
          groups={groups}
          lang={lang}
          surface="public"
          langBasePath="/faq"
          emptyMessage={
            lang === "fr"
              ? "Aucune question n'est publiée pour le moment. Contactez-nous et nous vous répondrons directement."
              : "No FAQs are available right now. Please contact our office for help."
          }
        />
      </div>
    </div>
  );
}
