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

async function seedAlertRoutingRules() {
  for (const rule of ALERT_ROUTING_DEFAULTS) {
    await db.alertRoutingRule.upsert({
      where: {
        alertType_recipientRole: {
          alertType: rule.alertType,
          recipientRole: rule.recipientRole,
        },
      },
      update: {},
      create: { ...rule, isActive: true },
    });
  }
  console.log(
    `Seeded ${ALERT_ROUTING_DEFAULTS.length} AlertRoutingRule defaults.`,
  );
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
