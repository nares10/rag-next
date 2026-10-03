/*
  Warnings:

  - You are about to drop the column `emailVerified` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `EmailVerificationToken` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PendingRegistration` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "EmailVerificationToken" DROP CONSTRAINT "EmailVerificationToken_userId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "emailVerified";

-- DropTable
DROP TABLE "EmailVerificationToken";

-- DropTable
DROP TABLE "PendingRegistration";
