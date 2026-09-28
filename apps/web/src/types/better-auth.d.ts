// Type augmentation for better-auth custom session
import "better-auth";

declare module "better-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      image?: string | null;
      emailVerified: boolean;
      createdAt: Date;
      updatedAt: Date;
      role: "OWNER" | "ADMIN" | "EMPLOYEE";
    };
  }
}

