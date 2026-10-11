import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { __pgrowPrisma?: PrismaClient };

export const prisma = globalForPrisma.__pgrowPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.__pgrowPrisma = prisma;
