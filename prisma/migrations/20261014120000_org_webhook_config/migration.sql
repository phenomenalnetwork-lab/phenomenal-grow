-- Per-organisation Meta webhook credentials (manual setup).
-- Secrets stored as AES-256-GCM ciphertexts (enc1:) by the API crypto helper.
CREATE TABLE "WhatsappConfig" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "verifyToken" TEXT NOT NULL,
    "appSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappConfig_orgId_key" ON "WhatsappConfig"("orgId");

-- AddForeignKey
ALTER TABLE "WhatsappConfig" ADD CONSTRAINT "WhatsappConfig_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Manual-setup connection proof on numbers (NULL = saved but never tested).
ALTER TABLE "WhatsappNumber" ADD COLUMN "lastTestedAt" TIMESTAMP(3),
ADD COLUMN "lastTestOk" BOOLEAN;
