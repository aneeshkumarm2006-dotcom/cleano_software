"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { normalizeAllowedCategories } from "@/lib/service-permissions";

type State = {
  message: string;
  error: string;
};

export async function updateEmployee(
  employeeId: string,
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
  const role = formData.get("role") as string;
  // Checkbox: present ("on") = active, absent ("") = deactivated.
  const isActive = formData.get("isActive") === "on";
  // Service categories (awerfixes.pdf item 3). The marker field says "this
  // submission owns the category picker", so an empty selection means "the admin
  // cleared every restriction" rather than "this form doesn't manage
  // categories" — without it, the create form would wipe the column. Same
  // contract saveJob uses for `cleanersSubmitted`.
  const categoriesSubmitted = formData.get("categoriesSubmitted") === "1";
  const allowedServiceCategories = categoriesSubmitted
    ? normalizeAllowedCategories(formData.getAll("serviceCategories"))
    : null;

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
        role: role as "OWNER" | "ADMIN" | "OPS_MANAGER" | "FIELD_LEAD" | "EMPLOYEE",
        isActive,
        ...(allowedServiceCategories ? { allowedServiceCategories } : {}),
      },
    });

    revalidatePath("/admin/employees");
    revalidatePath(`/admin/employees/${employeeId}`);
    if (allowedServiceCategories) revalidatePath("/cleaners/available-jobs");
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

