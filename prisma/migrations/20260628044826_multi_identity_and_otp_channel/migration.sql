-- CreateEnum
CREATE TYPE "OtpChannel" AS ENUM ('EMAIL', 'SMS');

-- AlterTable: generalize Otp from email-keyed to identifier-keyed (email or phone)
ALTER TABLE "Otp" RENAME COLUMN "email" TO "identifier";
ALTER TABLE "Otp" ADD COLUMN     "channel" "OtpChannel" NOT NULL DEFAULT 'EMAIL';

-- AlterTable: multi-identity User — email becomes optional, phoneNumber becomes unique
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");
