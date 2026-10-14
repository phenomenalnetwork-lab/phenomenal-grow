-- CreateEnum
CREATE TYPE "MsgStatus" AS ENUM ('SENT', 'DELIVERED', 'READ', 'FAILED');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "status" "MsgStatus" NOT NULL DEFAULT 'SENT',
ADD COLUMN     "statusAt" TIMESTAMP(3),
ADD COLUMN     "templateName" TEXT;
