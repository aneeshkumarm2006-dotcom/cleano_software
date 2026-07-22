// The crew login is a common place to install the app from ("Add to Home
// Screen" while signed out). Point it at the CREW manifest so the shortcut
// starts at /cleaners/my-jobs rather than "/" (the customer portal) — the page
// itself is a client component, so the manifest override lives here.
import { InstallProvider } from "@/components/InstallContext";

export const metadata = {
  manifest: "/api/cleaner-manifest",
};

export default function CleanosAuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Provider so the login page can offer a real "Install app" button — this is
  // where crew members go looking for the download.
  return <InstallProvider>{children}</InstallProvider>;
}
