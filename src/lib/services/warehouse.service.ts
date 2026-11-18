import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export type CreateWarehouseInput = {
  name: string;
  code: string;
  address?: string | null;
  description?: string | null;
  isDefault?: boolean;
};

export async function createWarehouse(
  organizationId: string,
  input: CreateWarehouseInput,
) {
  return prisma.$transaction(async (tx) => {
    const activeWarehouseCount = await tx.warehouse.count({
      where: {
        organizationId,
        isActive: true,
      },
    });

    // The first active warehouse must be the default.
    const shouldBeDefault =
      activeWarehouseCount === 0 || input.isDefault === true;

    // Only one default warehouse per organization.
    if (shouldBeDefault) {
      await tx.warehouse.updateMany({
        where: {
          organizationId,
          isDefault: true,
        },
        data: {
          isDefault: false,
        },
      });
    }

    const warehouse = await tx.warehouse.create({
      data: {
        organizationId,
        name: input.name,
        code: input.code.trim().toUpperCase(),
        address: input.address ?? null,
        description: input.description ?? null,
        isDefault: shouldBeDefault,
        isActive: true,
      },
    });

    // Initialize zero balances for all active products.
    const products = await tx.product.findMany({
      where: {
        organizationId,
        isActive: true,
      },
      select: {
        id: true,
      },
    });

    if (products.length > 0) {
      await tx.inventoryBalance.createMany({
        data: products.map((product) => ({
          organizationId,
          productId: product.id,
          warehouseId: warehouse.id,
          quantityOnHand: 0,
          reservedQuantity: 0,
        })),
      });
    }

    return warehouse;
  });
}
