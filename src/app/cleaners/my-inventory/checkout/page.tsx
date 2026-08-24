import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/org-db";
import CheckoutClient from "./CheckoutClient";

export default async function CheckoutPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/cleanos/login");
  }

  const locations = await db.inventoryLocation.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <CheckoutClient
        locations={locations.map((l) => ({
          id: l.id,
          name: l.name,
          address: l.address,
        }))}
      />
    </div>
  );
}
