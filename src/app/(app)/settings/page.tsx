import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import SettingsClient from "./SettingsClient";

export default async function SettingsPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  const userWithRole = session.user as typeof session.user & {
    role: "OWNER" | "ADMIN" | "EMPLOYEE";
  };
  const isAdmin =
    userWithRole.role === "OWNER" || userWithRole.role === "ADMIN";

  // Fetch all settings data in parallel (admin only)
  const [
    appSettings,
    products,
    kitTemplates,
    inventoryRules,
    suppliers,
  ] = isAdmin
    ? await Promise.all([
        db.appSetting.findMany(),
        db.product.findMany({ orderBy: { name: "asc" } }),
        db.kitTemplate.findMany({
          include: {
            items: { include: { product: true } },
          },
          orderBy: { name: "asc" },
        }),
        db.inventoryRule.findMany({ include: { product: true } }),
        db.supplier.findMany({
          include: {
            prices: { include: { product: true } },
          },
          orderBy: { name: "asc" },
        }),
      ])
    : [[], [], [], [], []];

  return (
    <SettingsClient
      user={userWithRole}
      isAdmin={isAdmin}
      appSettings={appSettings as never}
      products={products as never}
      kitTemplates={kitTemplates as never}
      inventoryRules={inventoryRules as never}
      suppliers={suppliers as never}
    />
  );
}
