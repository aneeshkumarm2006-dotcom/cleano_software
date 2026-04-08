"use server";

import { db } from "@/db";
import { revalidatePath } from "next/cache";

type State = {
  message: string;
  error: string;
};

export async function updateEmployee(
  employeeId: string,
  prevState: State,
  formData: FormData
): Promise<State> {
  const name = formData.get("name") as string;
  const email = formData.get("email") as string;
  const phone = formData.get("phone") as string;
  const role = formData.get("role") as string;

  // Validate required fields
  if (!name || !email || !role) {
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

  try {
    // Check if email already exists (excluding current user)
    const existingUser = await db.user.findFirst({
      where: {
        email,
        NOT: {
          id: employeeId,
        },
      },
    });

    if (existingUser) {
      return {
        message: "",
        error: "An employee with this email already exists.",
      };
    }

    // Update the user
    await db.user.update({
      where: { id: employeeId },
      data: {
        name,
        email,
        phone: phone || null,
        role: role as "OWNER" | "ADMIN" | "EMPLOYEE",
      },
    });

    revalidatePath("/employees");
    return {
      message: "Employee updated successfully!",
      error: "",
    };
  } catch (error) {
    console.error("Error updating employee:", error);
    return {
      message: "",
      error: "Failed to update employee. Please try again.",
    };
  }
}

