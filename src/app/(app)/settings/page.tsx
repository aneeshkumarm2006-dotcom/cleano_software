import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import SettingsClient from "./SettingsClient";

export default async function SettingsPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  const userWithRole = session.user as typeof session.user & { role: "OWNER" | "ADMIN" | "EMPLOYEE" };

  return <SettingsClient user={userWithRole} />;
}

