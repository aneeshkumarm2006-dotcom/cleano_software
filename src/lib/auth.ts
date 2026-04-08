import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { customSession } from "better-auth/plugins"

import { db } from "@/db";

export const auth = betterAuth({
  database: prismaAdapter(db, {
    provider: "postgresql",
  }),
  emailAndPassword: { 
    enabled: true,
  },
  plugins: [customSession(async (session) => {
      if (session.user) {
        // Get all user data in a single query with selected fields for performance
        const userProfile = await db.user.findUnique({
          where: { id: session.user.id },
        });
        // Pre-compute access control data to avoid runtime calculations
        const enhancedUser = {
          ...session.user,
          role: userProfile?.role || 'USER',
        };
        
        return {
          ...session,
          user: enhancedUser,
        };
      }
      return session;
  })],
  secret: process.env.BETTER_AUTH_SECRET!,
});