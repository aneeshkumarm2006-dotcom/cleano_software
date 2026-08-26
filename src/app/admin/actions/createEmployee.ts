"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { hashPassword } from "better-auth/crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { sendAccountEmail } from "@/lib/email";

type State = {
  message: string;
  error: string;
};

export default async function createEmployee(
  prevState: State,
  formData: FormData
): Promise<State> {
  const session = await auth.api.getSession({ headers: await headers() });
  const actorRole = (session?.user as { role?: string } | undefined)?.role;
  if (actorRole !== "OWNER" && actorRole !== "ADMIN") {
    return { message: "", error: "Not authorized." };
  }

  const name = formData.get("name") as string;
  const email = formData.get("email") as string;
  const phone = formData.get("phone") as string;
  const password = formData.get("password") as string;
  const role = formData.get("role") as string;

  // Validate required fields
  if (!name || !email || !password || !role) {
    return {
      message: "",
      error: "Please fill in all required fields.",
    };
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return {
      message: "",
      error: "Please enter a valid email address.",
    };
  }

  // Validate password length
  if (password.length < 8) {
    return {
      message: "",
      error: "Password must be at least 8 characters long.",
    };
  }

  try {
    // Check if email already exists
    const existingUser = await db.user.findFirst({
      where: { email },
    });

    if (existingUser) {
      return {
        message: "",
        error: "An employee with this email already exists.",
      };
    }

    // Hash the password with better-auth's scrypt hasher so sign-in verifies.
    const hashedPassword = await hashPassword(password);

    // Create the user
    const user = await db.user.create({
      data: {
        name,
        email,
        phone: phone || null,
        emailVerified: true, // Auto-verify admin-created accounts
        role: role as "OWNER" | "ADMIN" | "OPS_MANAGER" | "FIELD_LEAD" | "EMPLOYEE",
      },
    });

    // Create the password account for the user
    await db.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: hashedPassword,
      },
    });

    // Welcome emails — gated. "How it works" + "New account" + "Activated"
    // (admin-created accounts are auto-verified, so they are immediately active).
    const sendRole = role === "CLIENT" ? "CUSTOMER" : "PROVIDER";
    sendAccountEmail({
      to: email,
      name,
      role: sendRole,
      event: "new_account",
    }).catch((e) => console.error("new_account email", e));
    if (sendRole === "PROVIDER") {
      sendAccountEmail({
        to: email,
        name,
        role: "PROVIDER",
        event: "how_it_works",
      }).catch((e) => console.error("how_it_works email", e));
    }
    sendAccountEmail({
      to: email,
      name,
      role: sendRole,
      event: "activated",
    }).catch((e) => console.error("activated email", e));

    revalidatePath("/admin/employees");
    return {
      message: "Employee created successfully!",
      error: "",
    };
  } catch (error) {
    console.error("Error creating employee:", error);
    return {
      message: "",
      error: "Failed to create employee. Please try again.",
    };
  }
}