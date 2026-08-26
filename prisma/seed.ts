import { AlertType, PrismaClient, Roles } from "@prisma/client";

const db = new PrismaClient();

const ALERT_ROUTING_DEFAULTS: ReadonlyArray<{
  alertType: AlertType;
  recipientRole: Roles;
}> = [
  { alertType: AlertType.LOW_INVENTORY, recipientRole: Roles.OPS_MANAGER },
  { alertType: AlertType.PROVIDER_LOW_STOCK, recipientRole: Roles.FIELD_LEAD },
  { alertType: AlertType.PROVIDER_LOW_STOCK, recipientRole: Roles.OPS_MANAGER },
  { alertType: AlertType.CANCELLATION, recipientRole: Roles.OPS_MANAGER },
  { alertType: AlertType.CANCELLATION, recipientRole: Roles.FIELD_LEAD },
  { alertType: AlertType.OVERDUE_PAYMENT, recipientRole: Roles.OPS_MANAGER },
  { alertType: AlertType.OVERDUE_PAYMENT, recipientRole: Roles.ADMIN },
  { alertType: AlertType.OVERDUE_COMMERCIAL, recipientRole: Roles.OPS_MANAGER },
  { alertType: AlertType.OVERDUE_COMMERCIAL, recipientRole: Roles.ADMIN },
  { alertType: AlertType.OVERDUE_COMMERCIAL, recipientRole: Roles.OWNER },
  { alertType: AlertType.CLEANER_PAYMENT, recipientRole: Roles.EMPLOYEE },
  { alertType: AlertType.CLEANER_PAYMENT, recipientRole: Roles.OPS_MANAGER },
  { alertType: AlertType.IMMEDIATE_PAYOUT, recipientRole: Roles.EMPLOYEE },
  { alertType: AlertType.IMMEDIATE_PAYOUT, recipientRole: Roles.OPS_MANAGER },
  { alertType: AlertType.CLIENT_COMPLAINT, recipientRole: Roles.FIELD_LEAD },
  { alertType: AlertType.CLIENT_COMPLAINT, recipientRole: Roles.OPS_MANAGER },
  { alertType: AlertType.RATING_DECREASE, recipientRole: Roles.EMPLOYEE },
  { alertType: AlertType.RATING_DECREASE, recipientRole: Roles.FIELD_LEAD },
  { alertType: AlertType.RATING_DECREASE, recipientRole: Roles.OPS_MANAGER },
  { alertType: AlertType.CLEANER_STRIKE, recipientRole: Roles.OPS_MANAGER },
  { alertType: AlertType.CLEANER_STRIKE, recipientRole: Roles.ADMIN },
  { alertType: AlertType.GENERAL, recipientRole: Roles.OPS_MANAGER },
];

// Alert routing is per-organization now, so the defaults are seeded for each
// one rather than once globally. This runs with the unscoped client and names
// the organization explicitly, because a seed has no request to resolve one
// from.
async function seedAlertRoutingRules() {
  const orgs = await db.organization.findMany({ select: { id: true, slug: true } });
  if (orgs.length === 0) {
    console.log("No organizations yet — nothing to seed.");
    return;
  }
  for (const org of orgs) {
    for (const rule of ALERT_ROUTING_DEFAULTS) {
      await db.alertRoutingRule.upsert({
        where: {
          organizationId_alertType_recipientRole: {
            organizationId: org.id,
            alertType: rule.alertType,
            recipientRole: rule.recipientRole,
          },
        },
        update: {},
        create: { ...rule, isActive: true, organizationId: org.id },
      });
    }
    console.log(`  ${org.slug}: ${ALERT_ROUTING_DEFAULTS.length} rules`);
  }
  console.log(`Seeded AlertRoutingRule defaults for ${orgs.length} organization(s).`);
}

async function main() {
  await seedAlertRoutingRules();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
