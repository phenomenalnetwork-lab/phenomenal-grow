import path from "node:path";
import { config as loadEnv } from "dotenv";

// Next.js only auto-loads .env from apps/web; ours lives at the repo root.
if (!process.env.DATABASE_URL) {
  loadEnv({ path: path.join(process.cwd(), "..", "..", ".env") });
}

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { __pgrowPrisma?: PrismaClient };

export const prisma = globalForPrisma.__pgrowPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.__pgrowPrisma = prisma;
