"use server";

import { db } from "@/db";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";

type State = {
  message: string;
  error: string;
};

export default async function createEmployee(
  prevState: State,
  formData: FormData
): Promise<State> {
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
    const existingUser = await db.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return {
        message: "",
        error: "An employee with this email already exists.",
      };
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create the user
    const user = await db.user.create({
      data: {
        name,
        email,
        phone: phone || null,
        emailVerified: true, // Auto-verify admin-created accounts
        role: role as "OWNER" | "ADMIN" | "EMPLOYEE",
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

    revalidatePath("/employees");
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