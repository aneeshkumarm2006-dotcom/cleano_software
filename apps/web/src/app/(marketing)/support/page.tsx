import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import SiteShell from "../_site/SiteShell";
import { SUPPORT_EMAIL, SUPPORT_RESPONSE_TIME } from "../_site/contact";

export const metadata: Metadata = {
  title: "Support",
  description:
    "Get help with Bookmops and the Bookmops Pro app: who to contact, and answers to common questions.",
};

/**
 * Bookmops' support page — the URL App Store Connect asks for, and where a
 * cleaner lands when something in Bookmops Pro is not working.
 *
 * The in-app paths named here (More → Office chat, More → Account → Delete my
 * account, "Forgot your password?") are the staff app's actual labels. If
 * those move, update this page too.
 */
const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "I can’t sign in, or I forgot my password",
    a: (
      <p>
        On the sign-in screen, tap <strong>&ldquo;Forgot your password?&rdquo;</strong> and enter
        your <strong>work email</strong> &mdash; the one your company used to set up your account.
        We&rsquo;ll email you a link to choose a new password. If the email doesn&rsquo;t arrive,
        check your spam folder, then ask your company&rsquo;s office to confirm the email address
        they have for you.
      </p>
    ),
  },
  {
    q: "It says my company can’t be found",
    a: (
      <p>
        Bookmops finds your company from your work email, and your employer creates your account
        &mdash; you can&rsquo;t sign up on your own. Ask your company&rsquo;s office to add you, or
        to check the email address they entered.
      </p>
    ),
  },
  {
    q: "Notifications aren’t arriving",
    a: (
      <p>
        Open your phone&rsquo;s <strong>Settings &rarr; Bookmops Pro &rarr; Notifications</strong>{" "}
        and make sure notifications are allowed. Check that Focus or Do Not Disturb isn&rsquo;t on,
        then open the app once while connected to the internet.
      </p>
    ),
  },
  {
    q: "I clocked in or out while offline",
    a: (
      <p>
        That&rsquo;s fine. Your times are saved on your phone and sync when you&rsquo;re back
        online. If there&rsquo;s a big gap between when you tapped and when it synced, the office
        reviews it.
      </p>
    ),
  },
  {
    q: "How do I delete my account?",
    a: (
      <p>
        In the app, go to <strong>More &rarr; Account &rarr; Delete my account</strong>. The request
        goes to your company, which deletes your account and lets you know. Records the law requires
        them to keep, such as pay records, are kept for the required period. See our{" "}
        <Link href="/privacy#rights">Privacy Policy</Link> for details.
      </p>
    ),
  },
  {
    q: "How does a cleaning company sign up?",
    a: (
      <p>
        A cleaning company can create its own Bookmops workspace and{" "}
        <Link href="/get-started">start a free trial here</Link>.
      </p>
    ),
  },
];

export default function SupportPage() {
  const mail = `mailto:${SUPPORT_EMAIL}`;
  return (
    <SiteShell>
      <article className="mk-wrap">
        <div className="mk-doc">
          <p className="mk-eyebrow">
            <span className="mk-dot" aria-hidden="true" />
            Help
          </p>
          <h1 className="mk-h1">Support</h1>
          <p className="mk-lead">
            Bookmops is the software your cleaning company uses to run its jobs, schedules and pay,
            and Bookmops Pro is its app for staff. Here&rsquo;s how to get help.
          </p>

          <section aria-labelledby="office-h" className="mk-doc-card">
            <h2 id="office-h">Work questions: contact your company first</h2>
            <p>
              Questions about your schedule, jobs, hours, pay or time off are for your company&rsquo;s
              office. In the app, go to <strong>More &rarr; Office chat</strong>.
            </p>
          </section>

          <section aria-labelledby="us-h">
            <h2 id="us-h">App or account problems: contact Bookmops</h2>
            <p>
              If the app isn&rsquo;t working, or you have a problem your office can&rsquo;t fix, email{" "}
              <a href={mail}>{SUPPORT_EMAIL}</a>. Tell us your company&rsquo;s name, your work email,
              your phone model, and what happened. We aim to reply {SUPPORT_RESPONSE_TIME}.
            </p>
            <p>Never send us your password. We will never ask for it.</p>
          </section>

          <section aria-labelledby="faq-h" className="mk-doc-faq">
            <h2 id="faq-h">Common questions</h2>
            {FAQ.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <div>{item.a}</div>
              </details>
            ))}
          </section>

          <section aria-labelledby="privacy-h">
            <h2 id="privacy-h">Privacy</h2>
            <p>
              To learn what information Bookmops handles and how to exercise your rights, read our{" "}
              <Link href="/privacy">Privacy Policy</Link>.
            </p>
          </section>
        </div>
      </article>
    </SiteShell>
  );
}
