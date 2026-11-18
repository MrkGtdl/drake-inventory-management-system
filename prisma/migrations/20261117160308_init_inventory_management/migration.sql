-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE_RECEIPT', 'SALE', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'RETURN_IN', 'RETURN_OUT');

-- CreateTable
CREATE TABLE "warehouse" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" TEXT,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "productCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "categoryId" TEXT,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "costPrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sellingPrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reorderLevel" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "image" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventoryBalance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantityOnHand" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "reservedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventoryBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stockMovement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unitCost" DECIMAL(18,2),
    "reference" TEXT,
    "transferGroupId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skuCounter" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skuCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "warehouse_organizationId_isActive_idx" ON "warehouse"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_organizationId_code_key" ON "warehouse"("organizationId", "code");

-- CreateIndex
CREATE INDEX "productCategory_organizationId_isActive_idx" ON "productCategory"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "productCategory_organizationId_name_key" ON "productCategory"("organizationId", "name");

-- CreateIndex
CREATE INDEX "product_organizationId_name_idx" ON "product"("organizationId", "name");

-- CreateIndex
CREATE INDEX "product_organizationId_categoryId_idx" ON "product"("organizationId", "categoryId");

-- CreateIndex
CREATE INDEX "product_organizationId_isActive_idx" ON "product"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "product_organizationId_sku_key" ON "product"("organizationId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "product_organizationId_barcode_key" ON "product"("organizationId", "barcode");

-- CreateIndex
CREATE INDEX "inventoryBalance_organizationId_warehouseId_idx" ON "inventoryBalance"("organizationId", "warehouseId");

-- CreateIndex
CREATE INDEX "inventoryBalance_organizationId_productId_idx" ON "inventoryBalance"("organizationId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "inventoryBalance_productId_warehouseId_key" ON "inventoryBalance"("productId", "warehouseId");

-- CreateIndex
CREATE INDEX "stockMovement_organizationId_createdAt_idx" ON "stockMovement"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "stockMovement_organizationId_productId_createdAt_idx" ON "stockMovement"("organizationId", "productId", "createdAt");

-- CreateIndex
CREATE INDEX "stockMovement_organizationId_warehouseId_createdAt_idx" ON "stockMovement"("organizationId", "warehouseId", "createdAt");

-- CreateIndex
CREATE INDEX "stockMovement_transferGroupId_idx" ON "stockMovement"("transferGroupId");

-- CreateIndex
CREATE INDEX "stockMovement_actorId_idx" ON "stockMovement"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "skuCounter_organizationId_key" ON "skuCounter"("organizationId");

-- AddForeignKey
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productCategory" ADD CONSTRAINT "productCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "productCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventoryBalance" ADD CONSTRAINT "inventoryBalance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventoryBalance" ADD CONSTRAINT "inventoryBalance_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventoryBalance" ADD CONSTRAINT "inventoryBalance_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stockMovement" ADD CONSTRAINT "stockMovement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stockMovement" ADD CONSTRAINT "stockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stockMovement" ADD CONSTRAINT "stockMovement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stockMovement" ADD CONSTRAINT "stockMovement_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skuCounter" ADD CONSTRAINT "skuCounter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
