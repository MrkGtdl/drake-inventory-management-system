import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

loadEnvConfig(process.cwd());

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const organizationId = "fMW5eYpuS0n2arpEIHaUliHzuVfQDsah";

async function main() {
  const result = await prisma.$transaction(async (tx) => {
    // Create or reuse the organization's Main Warehouse.
    const warehouse = await tx.warehouse.upsert({
      where: {
        organizationId_code: {
          organizationId,
          code: "MAIN",
        },
      },
      create: {
        organizationId,
        name: "Main Warehouse",
        code: "MAIN",
        description: "Default inventory storage location",
        isDefault: true,
        isActive: true,
      },
      update: {
        name: "Main Warehouse",
        isDefault: true,
        isActive: true,
      },
    });

    // Ensure the organization's SKU counter exists.
    await tx.skuCounter.upsert({
      where: { organizationId },
      create: { organizationId, lastValue: 0 },
      update: {},
    });

    // Find all existing products in this organization.
    const products = await tx.product.findMany({
      where: { organizationId },
      select: { id: true },
    });

    // Initialize zero-stock balances.
    if (products.length > 0) {
      await tx.inventoryBalance.createMany({
        data: products.map((product) => ({
          organizationId,
          productId: product.id,
          warehouseId: warehouse.id,
          quantityOnHand: 0,
          reservedQuantity: 0,
        })),
        skipDuplicates: true,
      });
    }

    return {
      warehouse,
      productCount: products.length,
    };
  });

  console.log("Setup completed successfully!");
  console.log("Warehouse ID:", result.warehouse.id);
  console.log("Warehouse:", result.warehouse.name);
  console.log("Products initialized:", result.productCount);
}

main()
  .catch((error) => {
    console.error("Setup failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
