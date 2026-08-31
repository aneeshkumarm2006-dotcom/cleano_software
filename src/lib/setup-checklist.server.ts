/**
 * What a brand-new workspace still has to fill in before it can trade.
 *
 * Awer hands a new company an EMPTY workspace — no services priced for their
 * city, no postal codes they cover, no cleaners, no card processing. Every one
 * of those has a working default or an empty table behind it, so the app never
 * crashes; it just quietly behaves like somebody else's business. A company in
 * Calgary that books its first customer on the shipped defaults quotes Montreal
 * prices and charges Quebec sales tax.
 *
 * So this is a checklist, not a tour. A tour is shown once, skipped, and can
 * only DESCRIBE the setup — it never knows whether any of it happened. Each row
 * below reads the same record the feature itself reads, so it states what is
 * actually there ("4 areas", "not reviewed"), it stays until the work is really
 * done, and the whole card disappears once nothing is left. An established
 * workspace like Cleano therefore never sees it at all.
 *
 * DEFAULTS ARE NOT A PASS, and the wording says so. Services, pricing and tax
 * all fall back to shipped values when their AppSetting row is absent, so the
 * honest signal is "has an admin saved this yet" and the honest label is
 * "not reviewed" rather than "missing".
 */
import "server-only";
import { db } from "@/lib/org-db";
import { orgStripeStatus } from "@/lib/stripe-org";
import { SERVICE_CATALOG_KEY } from "@/lib/service-catalog";
import { SERVICE_PRICING_KEY } from "@/lib/service-pricing";

export interface SetupStep {
  id: string;
  /** What the admin is being asked to do. */
  label: string;
  /** What goes wrong until they do — the reason the row is here at all. */
  why: string;
  /** The live reading, e.g. "4 areas" or "not reviewed". Never a guess. */
  state: string;
  done: boolean;
  /**
   * True when NOTHING can be booked until this is done, as opposed to being
   * booked against the wrong defaults. Exactly one step is blocking today.
   */
  blocking: boolean;
  href: string;
  /** An extra caution shown under a step that is done but easy to half-do. */
  note?: string;
}

/** The settings keys read below, fetched in one query rather than five. */
const KEYS = [
  "general.businessName",
  "general.businessEmail",
  "general.businessPhone",
  SERVICE_CATALOG_KEY,
  SERVICE_PRICING_KEY,
  "tax.config",
] as const;

/**
 * Has an admin actually saved something here?
 *
 * A row whose value is an empty string, empty array or empty object is a row
 * somebody opened and left — the app falls back to the default exactly as if it
 * were absent, so the checklist must too.
 */
function filled(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

export async function readSetupChecklist(opts: {
  /**
   * Active cleaners — OPS_MANAGER, FIELD_LEAD and EMPLOYEE, which is what
   * `getEmployeeCounts` counts. It deliberately EXCLUDES the owner and any
   * admin, so one here is already a real team rather than the founder counting
   * themselves. The dashboard has this number already; it is not re-queried.
   */
  cleanerCount: number;
}): Promise<SetupStep[]> {
  const [settings, serviceAreas, stripe] = await Promise.all([
    db.appSetting.findMany({
      where: { key: { in: [...KEYS] } },
      select: { key: true, value: true },
    }),
    // isActive, because that is the flag the booking form's own lookup applies
    // (checkServiceAreaInternal). A table of deactivated zones covers nobody.
    db.serviceArea.count({ where: { isActive: true } }),
    orgStripeStatus(),
  ]);

  const saved = new Map(settings.map((s) => [s.key, s.value]));
  const has = (key: string) => filled(saved.get(key));

  const identityDone =
    has("general.businessName") && has("general.businessEmail");

  const teamDone = opts.cleanerCount > 0;

  const steps: SetupStep[] = [
    {
      id: "identity",
      label: "Your business details",
      why: "Every email, invoice and receipt is signed with these. Left blank, customers get a receipt from nobody.",
      state: identityDone
        ? has("general.businessPhone")
          ? "name, email and phone set"
          : "set · no phone yet"
        : "not filled in",
      done: identityDone,
      blocking: false,
      href: "/admin/settings?tab=general",
    },
    {
      id: "serviceAreas",
      label: "The areas you cover",
      why: "The booking form checks the customer's postal code against this list. With the list empty it turns every address away.",
      state:
        serviceAreas === 0
          ? "none yet"
          : `${serviceAreas} ${serviceAreas === 1 ? "area" : "areas"}`,
      done: serviceAreas > 0,
      blocking: true,
      href: "/admin/settings?tab=serviceAreas",
    },
    {
      id: "services",
      label: "The services you offer",
      why: "Until you edit it, your booking page offers Awer's seven default services — including ones you may not sell.",
      state: has(SERVICE_CATALOG_KEY) ? "reviewed" : "using the defaults",
      done: has(SERVICE_CATALOG_KEY),
      blocking: false,
      href: "/admin/settings?tab=jobTypes",
    },
    {
      id: "pricing",
      label: "Your prices",
      why: "Quotes fall back to Awer's default rates, which were set for another city. Every online booking is priced from this.",
      state: has(SERVICE_PRICING_KEY) ? "reviewed" : "using the defaults",
      done: has(SERVICE_PRICING_KEY),
      blocking: false,
      href: "/admin/settings?tab=pricing",
    },
    {
      id: "tax",
      label: "Your sales tax",
      why: "The default is Quebec GST + QST. Anywhere else that is the wrong tax on every invoice you send.",
      state: has("tax.config") ? "reviewed" : "using Quebec rates",
      done: has("tax.config"),
      blocking: false,
      href: "/admin/settings?tab=tax",
    },
    {
      id: "team",
      label: "Your cleaners",
      why: "A job needs somebody to assign it to, and nobody has been added yet — only you.",
      state: teamDone
        ? `${opts.cleanerCount} on the team`
        : "none added yet",
      done: teamDone,
      blocking: false,
      href: "/admin/employees",
    },
    {
      id: "stripe",
      label: "Card payments",
      why: "Without a Stripe key this workspace can take cash and cheques only — no cards, no deposits, no saved cards on file.",
      state: stripe.connected ? "connected" : "not connected",
      done: stripe.connected,
      blocking: false,
      href: "/admin/settings?tab=payments",
      // Connected-but-no-webhook is the failure nobody notices: the charge goes
      // through and Stripe's confirmation never comes back, so the job sits
      // unpaid in Awer while the customer's card has already been debited.
      note:
        stripe.connected && !stripe.webhookConfigured
          ? "Connected, but no webhook secret yet — cards will charge and the job will never mark itself paid."
          : undefined,
    },
  ];

  return steps;
}
