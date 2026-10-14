/* Token hygiene: verify every stored WhatsApp token decrypts, optionally
 * re-encrypt legacy plaintext rows. NEVER touches message/contact data.
 * Usage: tsx scripts/reencrypt-tokens.ts [--apply]
 * Default is --check (read-only). --apply rewrites legacy rows only,
 * requires ENCRYPTION_KEY, and must run AFTER a verified backup.
 */
import { config as loadEnv } from "dotenv";
loadEnv();

import { PrismaClient } from "@prisma/client";
import { decryptToken, encryptToken } from "../apps/api/src/common/crypto";

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");
  const rows = await prisma.whatsappNumber.findMany({
    select: { id: true, label: true, accessToken: true },
  });
  let ok = 0;
  const bad: Array<{ id: string; label: string; reason: string }> = [];
  for (const r of rows) {
    try {
      decryptToken(r.accessToken);
      ok++;
    } catch (e) {
      bad.push({ id: r.id, label: r.label, reason: (e as Error).message });
    }
  }
  console.log(`checked=${rows.length} ok=${ok} bad=${bad.length}`);
  for (const b of bad) console.log(`BAD ${b.label} (${b.id}): ${b.reason}`);

  if (!apply) {
    console.log("check-only mode: no writes performed");
    if (bad.length > 0) process.exitCode = 1;
    return;
  }
  if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length < 16) {
    throw new Error("ENCRYPTION_KEY required for --apply");
  }
  const legacy = await prisma.whatsappNumber.findMany({ where: { NOT: { accessToken: { startsWith: "enc1:" } } } });
  for (const r of legacy) {
    await prisma.whatsappNumber.update({
      where: { id: r.id },
      data: { accessToken: encryptToken(r.accessToken) },
    });
    console.log(`re-encrypted ${r.label} (${r.id})`);
  }
  console.log(`re-encrypted=${legacy.length}`);
}

void main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
