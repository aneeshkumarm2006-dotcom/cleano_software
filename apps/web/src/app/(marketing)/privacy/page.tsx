import type { Metadata } from "next";
import Link from "next/link";

import SiteShell from "../_site/SiteShell";
import { OPERATOR, PRIVACY_EMAIL } from "../_site/contact";

export const metadata: Metadata = {
  title: "Privacy Policy · Bookmops",
  description:
    "How Bookmops, the software cleaning companies use to run their business, handles personal information.",
};

/**
 * Bookmops' own privacy policy, served at /privacy on the front door and on
 * every company's subdomain (see isPlatformPath and the root layout's gate).
 *
 * Every practice described here was checked against the code when it was
 * written — the sub-processor list against package.json and the server code,
 * the database region against the Supabase host (ca-central-1, AWS's Canada
 * Central region in Montréal), the one-shot location against the "On my way"
 * button and the staff app's config (background location off). If a feature
 * changes what it collects, this page has to change with it.
 */
const LAST_UPDATED = "September 28, 2026";

const SECTIONS = [
  ["who", "Who we are"],
  ["roles", "Whose data it is"],
  ["collect", "What we collect"],
  ["why", "Why we use it"],
  ["share", "Who we share it with"],
  ["where", "Where it is stored"],
  ["keep", "How long we keep it"],
  ["rights", "Your rights"],
  ["security", "Security"],
  ["children", "Children"],
  ["changes", "Changes to this policy"],
  ["contact", "Contact us"],
] as const;

export default function PrivacyPage() {
  const mail = `mailto:${PRIVACY_EMAIL}`;
  return (
    <SiteShell>
      <article className="mk-wrap">
        <div className="mk-doc">
          <p className="mk-eyebrow">
            <span className="mk-dot" aria-hidden="true" />
            Legal
          </p>
          <h1 className="mk-h1">Privacy Policy</h1>
          <p className="mk-doc-meta">Last updated: {LAST_UPDATED}</p>

          <p className="mk-lead">
            Bookmops is software that cleaning companies use to run their business: bookings,
            scheduling, staff, payments and messaging, plus the Bookmops Pro mobile app for their
            staff. This page explains, in plain language, what personal information passes through
            Bookmops, why, and what you can do about it.
          </p>

          <nav className="mk-doc-toc" aria-label="On this page" style={{ marginTop: 32 }}>
            <p>On this page</p>
            <ol>
              {SECTIONS.map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}`}>{label}</a>
                </li>
              ))}
            </ol>
          </nav>

          <section id="who" aria-labelledby="who-h">
            <h2 id="who-h">1. Who we are</h2>
            <p>
              Bookmops is operated by <strong>{OPERATOR}</strong>, a company incorporated in Canada,
              operating as Bookmops. Our person in charge of the protection of personal information
              can be reached at <a href={mail}>{PRIVACY_EMAIL}</a>.
            </p>
          </section>

          <section id="roles" aria-labelledby="roles-h">
            <h2 id="roles-h">2. Whose data it is</h2>
            <ul>
              <li>
                <strong>If you work for, or are a customer of, a cleaning company that uses
                Bookmops</strong>, that company decides what information it collects about you and
                what it does with it. It is responsible for your information. Bookmops stores and
                processes it on the company&rsquo;s behalf, to provide the service the company
                signed up for, and for no other purpose. The company&rsquo;s own privacy policy
                applies to you as well.
              </li>
              <li>
                <strong>If you visit our website, sign up for Bookmops, or pay us for a
                subscription</strong>, Bookmops is responsible for your information.
              </li>
            </ul>
          </section>

          <section id="collect" aria-labelledby="collect-h">
            <h2 id="collect-h">3. What we collect</h2>
            <p>Only what the cleaning company, its staff or its customers put into Bookmops, and what
              the service needs to work.</p>

            <h3>Account information</h3>
            <ul>
              <li>Name, work email, phone number and role (for example cleaner, manager or admin).</li>
              <li>A password, which is stored only as a one-way hash.</li>
              <li>For signed-in sessions: the IP address and browser or device type, to keep the
                account secure.</li>
            </ul>

            <h3>Work records (staff)</h3>
            <ul>
              <li>Jobs assigned to you, clock-in and clock-out times, and break times.</li>
              <li>Checklists you complete, photos of jobs, and problem reports.</li>
              <li>Pay information and withdrawal requests.</li>
              <li>Training progress.</li>
              <li>Documents you sign, with your signature and evidence of your consent (the time,
                the version and wording you agreed to, your IP address and device type).</li>
            </ul>

            <h3>Messages</h3>
            <ul>
              <li>Office chat, team chat and announcements.</li>
              <li>Reports of messages and blocks you make in team chat.</li>
            </ul>

            <h3>Location</h3>
            <p>
              The Bookmops Pro app reads your precise location <strong>only once</strong>, at the
              moment you tap <strong>&ldquo;On my way&rdquo;</strong> for a job, and{" "}
              <strong>only if your company has turned this on</strong> and you allow it on your
              phone. It is used to show the office how far away you are. You can say no and the
              notice still sends. The app <strong>never</strong> tracks your location in the
              background.
            </p>

            <h3>Device information</h3>
            <ul>
              <li>A push notification token for your phone, so the app can send you notifications.</li>
            </ul>

            <h3>Customers of cleaning companies</h3>
            <ul>
              <li>Booking details, contact details and service addresses.</li>
              <li>Payment information, which is handled by Stripe. Bookmops never sees or stores
                full card numbers.</li>
            </ul>

            <h3>AI assistant conversations</h3>
            <p>
              Some cleaning companies turn on an assistant that answers their customers by text
              message or email. For those companies, the messages in those conversations are stored
              in Bookmops and sent to Anthropic&rsquo;s Claude API to write the replies.
            </p>

            <h3>Our website</h3>
            <p>
              On Bookmops&rsquo; own marketing and sign-up pages we may use the Meta Pixel to
              measure our advertising. It is not used on this page, inside the app, or on any
              cleaning company&rsquo;s booking or customer pages.
            </p>
          </section>

          <section id="why" aria-labelledby="why-h">
            <h2 id="why-h">4. Why we use it</h2>
            <ul>
              <li>To provide the service: running jobs, schedules, pay, messaging and bookings for
                the cleaning company.</li>
              <li>To keep accounts and data secure and to prevent misuse.</li>
              <li>To meet legal and tax obligations, such as payroll and financial records.</li>
              <li>To answer support requests.</li>
            </ul>
            <p>
              <strong>We do not sell personal information.</strong> We do not use advertising
              tracking inside the app, and we do not use a cleaning company&rsquo;s data about its
              staff or customers for our own marketing.
            </p>
          </section>

          <section id="share" aria-labelledby="share-h">
            <h2 id="share-h">5. Who we share it with</h2>
            <p>
              We use the following service providers (sub-processors) to run Bookmops. Each receives
              only what it needs for its task.
            </p>
            <table className="mk-doc-table">
              <thead>
                <tr>
                  <th scope="col">Provider</th>
                  <th scope="col">What they do for us</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Supabase</td><td>Database hosting</td></tr>
                <tr><td>Vercel</td><td>Website and application hosting</td></tr>
                <tr><td>Cloudinary</td><td>Storing and serving photos</td></tr>
                <tr><td>Stripe</td><td>Payments</td></tr>
                <tr><td>Twilio</td><td>Text messages (SMS) and phone calls</td></tr>
                <tr><td>Resend</td><td>Sending email</td></tr>
                <tr><td>Anthropic</td><td>The AI assistant, for companies that turn it on</td></tr>
                <tr><td>Expo, Apple and Google</td><td>Delivering push notifications to phones</td></tr>
                <tr><td>Meta</td><td>Advertising measurement on our marketing pages only</td></tr>
              </tbody>
            </table>
            <p>
              We may also disclose information when the law requires it, for example in response to
              a valid court order.
            </p>
          </section>

          <section id="where" aria-labelledby="where-h">
            <h2 id="where-h">6. Where it is stored</h2>
            <p>
              The Bookmops database is hosted in <strong>Canada (Montréal region)</strong>. Some of
              the providers above, such as those for hosting, photos, email, text messages, payments
              and the AI assistant, may process information in other countries, including the
              United States. When that happens, the information may be accessible to the
              authorities of that country under its laws.
            </p>
          </section>

          <section id="keep" aria-labelledby="keep-h">
            <h2 id="keep-h">7. How long we keep it</h2>
            <ul>
              <li>We keep information while the cleaning company&rsquo;s Bookmops account is active.</li>
              <li>Work and pay records are kept for as long as the law requires for payroll and tax.</li>
              <li>Otherwise, information is deleted on request (see below).</li>
            </ul>
          </section>

          <section id="rights" aria-labelledby="rights-h">
            <h2 id="rights-h">8. Your rights</h2>
            <p>
              Under Canadian and Québec privacy law you can ask to <strong>access</strong> your
              information, <strong>correct</strong> it, have it <strong>deleted</strong>,{" "}
              <strong>withdraw your consent</strong>, and receive it in a{" "}
              <strong>portable</strong> format.
            </p>
            <h3>How to ask</h3>
            <ul>
              <li>
                <strong>Staff and customers of a cleaning company:</strong> ask the company first,
                because it is responsible for your information. You can also contact us at{" "}
                <a href={mail}>{PRIVACY_EMAIL}</a> and we will pass your request to them and help
                them answer it.
              </li>
              <li>
                <strong>Staff using Bookmops Pro:</strong> you can request deletion of your account
                in the app under <strong>More &rarr; Account &rarr; Delete my account</strong>. The
                request goes to your company, which deletes the account and lets you know. Records
                the law requires it to keep, such as pay records, are kept for the required period.
              </li>
              <li>
                <strong>Everyone else:</strong> email <a href={mail}>{PRIVACY_EMAIL}</a>.
              </li>
            </ul>
            <p>
              If you are not satisfied with our answer, you can complain to the Commission
              d&rsquo;accès à l&rsquo;information du Québec or the Office of the Privacy
              Commissioner of Canada.
            </p>
          </section>

          <section id="security" aria-labelledby="security-h">
            <h2 id="security-h">9. Security</h2>
            <ul>
              <li>All connections to Bookmops are encrypted in transit (HTTPS).</li>
              <li>Each cleaning company&rsquo;s data is kept separate, and people can only see the
                data of the company they belong to.</li>
              <li>Within a company, what someone can see and do depends on their role.</li>
              <li>Passwords are stored as one-way hashes, never in readable form.</li>
            </ul>
            <p>
              No system is perfectly secure. If a breach puts your information at risk, we will
              notify the affected company, you, and the authorities as the law requires.
            </p>
          </section>

          <section id="children" aria-labelledby="children-h">
            <h2 id="children-h">10. Children</h2>
            <p>
              Bookmops and the Bookmops Pro app are not intended for anyone under 16, and we do not
              knowingly collect information from them.
            </p>
          </section>

          <section id="changes" aria-labelledby="changes-h">
            <h2 id="changes-h">11. Changes to this policy</h2>
            <p>
              If we change this policy, we will update the date at the top of this page. If a
              change is significant, we will also let the cleaning companies that use Bookmops
              know.
            </p>
          </section>

          <section id="contact" aria-labelledby="contact-h">
            <h2 id="contact-h">12. Contact us</h2>
            <p>
              {OPERATOR}, operating as Bookmops
              <br />
              Privacy: <a href={mail}>{PRIVACY_EMAIL}</a>
            </p>
            <p>
              Need help with the app instead? See our <Link href="/support">Support page</Link>.
            </p>
          </section>
        </div>
      </article>
    </SiteShell>
  );
}
