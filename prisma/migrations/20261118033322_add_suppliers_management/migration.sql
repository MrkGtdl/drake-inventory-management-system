-- AlterTable
ALTER TABLE "stockMovement" ADD COLUMN     "supplierId" TEXT;

-- CreateTable
CREATE TABLE "supplier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "taxId" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_organizationId_name_idx" ON "supplier"("organizationId", "name");

-- CreateIndex
CREATE INDEX "supplier_organizationId_email_idx" ON "supplier"("organizationId", "email");

-- CreateIndex
CREATE INDEX "supplier_organizationId_phone_idx" ON "supplier"("organizationId", "phone");

-- CreateIndex
CREATE INDEX "supplier_organizationId_isActive_idx" ON "supplier"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_organizationId_code_key" ON "supplier"("organizationId", "code");

-- CreateIndex
CREATE INDEX "stockMovement_organizationId_supplierId_createdAt_idx" ON "stockMovement"("organizationId", "supplierId", "createdAt");

-- AddForeignKey
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stockMovement" ADD CONSTRAINT "stockMovement_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
