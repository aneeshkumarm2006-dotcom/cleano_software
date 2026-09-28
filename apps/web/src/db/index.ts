import { PrismaClient } from "@prisma/client";

// Global variable for the Prisma client to ensure singleton pattern
// eslint-disable-next-line no-var
declare global {
  var globalForPrisma: PrismaClient | undefined;
}

let db: PrismaClient;

if (process.env.NODE_ENV === "production") {
  db = new PrismaClient();
} else {
  if (!(global as any).globalForPrisma) {
    (global as any).globalForPrisma = new PrismaClient();
  }
  db = (global as any).globalForPrisma;
}

export { db };