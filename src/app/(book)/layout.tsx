// Just the page's own name. The root layout's title template appends the
// workspace's, so a Calgary customer no longer books a cleaning from "Cleano".
export const metadata = {
  title: "Book a cleaning",
  description: "Book a professional cleaning service in just a few clicks.",
};

export default function BookLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
