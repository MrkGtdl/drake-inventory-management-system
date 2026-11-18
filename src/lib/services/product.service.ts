import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

async function generateSku(
  tx: Prisma.TransactionClient,
  organizationId: string,
) {
  const counter = await tx.skuCounter.upsert({
    where: { organizationId },
    create: {
      organizationId,
      lastValue: 1,
    },
    update: {
      lastValue: {
        increment: 1,
      },
    },
    select: {
      lastValue: true,
    },
  });

  return `SKU-${String(counter.lastValue).padStart(6, "0")}`;
}

export type CreateProductInput = {
  name: string;
  description?: string | null;
  categoryId?: string | null;
  barcode?: string | null;
  unit: string;
  costPrice: number;
  sellingPrice: number;
  reorderLevel: number;
  image?: string | null;
};

export async function createProduct(
  organizationId: string,
  input: CreateProductInput,
) {
  return prisma.$transaction(async (tx) => {
    // Verify category belongs to the active organization.
    if (input.categoryId) {
      const category = await tx.productCategory.findFirst({
        where: {
          id: input.categoryId,
          organizationId,
          isActive: true,
        },
        select: { id: true },
      });

      if (!category) {
        throw new Error("INVALID_CATEGORY");
      }
    }

    const sku = await generateSku(tx, organizationId);

    const product = await tx.product.create({
      data: {
        organizationId,
        sku,
        name: input.name,
        description: input.description ?? null,
        categoryId: input.categoryId ?? null,
        barcode: input.barcode ?? null,
        unit: input.unit,
        costPrice: input.costPrice,
        sellingPrice: input.sellingPrice,
        reorderLevel: input.reorderLevel,
        image: input.image ?? null,
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Initialize a zero balance for every active warehouse.
    const warehouses = await tx.warehouse.findMany({
      where: {
        organizationId,
        isActive: true,
      },
      select: {
        id: true,
      },
    });

    if (warehouses.length > 0) {
      await tx.inventoryBalance.createMany({
        data: warehouses.map((warehouse) => ({
          organizationId,
          productId: product.id,
          warehouseId: warehouse.id,
          quantityOnHand: 0,
          reservedQuantity: 0,
        })),
      });
    }

    return product;
  });
}
