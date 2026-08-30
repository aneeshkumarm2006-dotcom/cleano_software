import { getOrgSlug } from "@/lib/org";
import { PLATFORM_ORG_SLUG } from "@/lib/tenant";

import PlatformSignIn from "./PlatformSignIn";
import SignInForm from "./SignInForm";

/**
 * The staff sign-in door, which two different audiences arrive at.
 *
 * On `<company>.useawer.com` it is that cleaning company's own admin login and
 * looks like them. On `useawer.com` it is Awer's, and has to look like Awer --
 * the page was shipped wearing TeamCleano's logo, their photo and "Loved by
 * 2,400+ Montréal homes", so a cleaning company signing in to the product was
 * greeted by another cleaning company's branding.
 *
 * The host is resolved on the server, where it is already authoritative, rather
 * than sniffed from `window.location` after hydration.
 */
export default async function SignInPage() {
  const slug = await getOrgSlug();

  // Two genuinely different pages behind one route. On Awer's own host we do
  // not know which company the visitor belongs to, so that version asks and
  // then hands off; on a workspace host the answer is the hostname, and the
  // existing form is left exactly as it was.
  if (slug === PLATFORM_ORG_SLUG) return <PlatformSignIn />;
  return <SignInForm isPlatform={false} />;
}
