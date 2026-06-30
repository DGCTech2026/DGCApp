-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('AUTH', 'RESET');

-- AlterTable: purpose-bind OTPs (AUTH = register/passwordless login, RESET = password reset)
ALTER TABLE "Otp" ADD COLUMN     "purpose" "OtpPurpose" NOT NULL DEFAULT 'AUTH';
