import { Prisma } from "@prisma/client";

type Db = Prisma.TransactionClient;

export async function logActivity(
  db: Db,
  data: {
    orgId: string;
    contactId?: string | null;
    type: string;
    actorId?: string;
    payload?: Prisma.InputJsonValue;
  },
) {
  await db.activity.create({
    data: {
      orgId: data.orgId,
      contactId: data.contactId ?? null,
      type: data.type,
      actorId: data.actorId ?? null,
      payload: data.payload ?? Prisma.JsonNull,
    },
  });
}
