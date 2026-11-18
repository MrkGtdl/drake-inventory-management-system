import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export type StockInInput = {
  productId: string;
  warehouseId: string;
  quantity: number;
  unitCost?: number | null;
  reference?: string | null;
  notes?: string | null;
};

export async function stockIn(
  organizationId: string,
  actorId: string,
  input: StockInInput,
) {
  return prisma.$transaction(async (tx) => {
    // Validate active product within the organization.
    const product = await tx.product.findFirst({
      where: {
        id: input.productId,
        organizationId,
        isActive: true,
      },
      select: { id: true, name: true, sku: true },
    });

    if (!product) {
      throw new Error("PRODUCT_NOT_FOUND");
    }

    // Validate active warehouse within the organization.
    const warehouse = await tx.warehouse.findFirst({
      where: {
        id: input.warehouseId,
        organizationId,
        isActive: true,
      },
      select: { id: true, name: true, code: true },
    });

    if (!warehouse) {
      throw new Error("WAREHOUSE_NOT_FOUND");
    }

    const quantity = new Prisma.Decimal(input.quantity);

    const unitCost =
      input.unitCost !== undefined && input.unitCost !== null
        ? new Prisma.Decimal(input.unitCost)
        : null;

    // Atomically increment the inventory balance.
    const balance = await tx.inventoryBalance.upsert({
      where: {
        productId_warehouseId: {
          productId: input.productId,
          warehouseId: input.warehouseId,
        },
      },
      create: {
        organizationId,
        productId: input.productId,
        warehouseId: input.warehouseId,
        quantityOnHand: quantity,
        reservedQuantity: 0,
      },
      update: {
        quantityOnHand: {
          increment: quantity,
        },
      },
      select: {
        id: true,
        quantityOnHand: true,
        reservedQuantity: true,
      },
    });

    // Record the stock movement.
    const movement = await tx.stockMovement.create({
      data: {
        organizationId,
        productId: input.productId,
        warehouseId: input.warehouseId,
        actorId,
        type: "PURCHASE_RECEIPT",
        quantity,
        unitCost,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
      },
    });

    return {
      product,
      warehouse,
      balance,
      movement,
    };
  });
}

export type StockOutInput = {
  productId: string;
  warehouseId: string;
  quantity: number;
  reference?: string | null;
  notes?: string | null;
};

export type StockTransferInput = {
  productId: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  quantity: number;
  reference?: string | null;
  notes?: string | null;
};

export type StockAdjustmentInput = {
  productId: string;
  warehouseId: string;
  type: "IN" | "OUT";
  quantity: number;
  reason: string;
  reference?: string | null;
  notes?: string | null;
};

export async function stockOut(
  organizationId: string,
  actorId: string,
  input: StockOutInput,
) {
  return prisma.$transaction(
    async (tx) => {
      const product = await tx.product.findFirst({
        where: {
          id: input.productId,
          organizationId,
          isActive: true,
        },
        select: { id: true, name: true, sku: true },
      });

      if (!product) {
        throw new Error("PRODUCT_NOT_FOUND");
      }

      const warehouse = await tx.warehouse.findFirst({
        where: {
          id: input.warehouseId,
          organizationId,
          isActive: true,
        },
        select: { id: true, name: true, code: true },
      });

      if (!warehouse) {
        throw new Error("WAREHOUSE_NOT_FOUND");
      }

      const quantity = new Prisma.Decimal(input.quantity);

      const balance = await tx.inventoryBalance.findFirst({
        where: {
          organizationId,
          productId: input.productId,
          warehouseId: input.warehouseId,
        },
        select: {
          id: true,
          quantityOnHand: true,
          reservedQuantity: true,
        },
      });

      if (!balance) {
        throw new Error("INSUFFICIENT_STOCK");
      }

      const availableStock = balance.quantityOnHand.minus(
        balance.reservedQuantity,
      );

      if (availableStock.lessThan(quantity)) {
        throw new Error("INSUFFICIENT_STOCK");
      }

      const updatedBalance = await tx.inventoryBalance.update({
        where: { id: balance.id },
        data: {
          quantityOnHand: {
            decrement: quantity,
          },
        },
        select: {
          id: true,
          quantityOnHand: true,
          reservedQuantity: true,
        },
      });

      const movement = await tx.stockMovement.create({
        data: {
          organizationId,
          productId: input.productId,
          warehouseId: input.warehouseId,
          actorId,
          type: "SALE",
          quantity,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
        },
      });

      return {
        product,
        warehouse,
        balance: updatedBalance,
        movement,
        availableStock: updatedBalance.quantityOnHand.minus(
          updatedBalance.reservedQuantity,
        ),
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

export async function stockTransfer(
  organizationId: string,
  actorId: string,
  input: StockTransferInput,
) {
  return prisma.$transaction(
    async (tx) => {
      // 1. Validate product
      const product = await tx.product.findFirst({
        where: {
          id: input.productId,
          organizationId,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          sku: true,
        },
      });

      if (!product) throw new Error("PRODUCT_NOT_FOUND");

      // 2. Prevent transferring to the same warehouse
      if (input.sourceWarehouseId === input.destinationWarehouseId) {
        throw new Error("SAME_WAREHOUSE");
      }

      // 3. Validate source warehouse
      const sourceWarehouse = await tx.warehouse.findFirst({
        where: {
          id: input.sourceWarehouseId,
          organizationId,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          code: true,
        },
      });

      if (!sourceWarehouse) throw new Error("SOURCE_WAREHOUSE_NOT_FOUND");

      // 4. Validate destination warehouse
      const destinationWarehouse = await tx.warehouse.findFirst({
        where: {
          id: input.destinationWarehouseId,
          organizationId,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          code: true,
        },
      });

      if (!destinationWarehouse) {
        throw new Error("DESTINATION_WAREHOUSE_NOT_FOUND");
      }

      const quantity = new Prisma.Decimal(input.quantity);

      // 5. Check source inventory
      const sourceBalance = await tx.inventoryBalance.findFirst({
        where: {
          organizationId,
          productId: input.productId,
          warehouseId: input.sourceWarehouseId,
        },
        select: {
          id: true,
          quantityOnHand: true,
          reservedQuantity: true,
        },
      });

      if (!sourceBalance) throw new Error("INSUFFICIENT_STOCK");

      const availableStock = sourceBalance.quantityOnHand.minus(
        sourceBalance.reservedQuantity,
      );

      if (availableStock.lessThan(quantity)) {
        throw new Error("INSUFFICIENT_STOCK");
      }

      // 6. Deduct from source warehouse
      const updatedSourceBalance = await tx.inventoryBalance.update({
        where: {
          id: sourceBalance.id,
        },
        data: {
          quantityOnHand: {
            decrement: quantity,
          },
        },
        select: {
          id: true,
          quantityOnHand: true,
          reservedQuantity: true,
        },
      });

      // 7. Add to destination warehouse
      const updatedDestinationBalance = await tx.inventoryBalance.upsert({
        where: {
          productId_warehouseId: {
            productId: input.productId,
            warehouseId: input.destinationWarehouseId,
          },
        },
        create: {
          organizationId,
          productId: input.productId,
          warehouseId: input.destinationWarehouseId,
          quantityOnHand: quantity,
          reservedQuantity: 0,
        },
        update: {
          quantityOnHand: {
            increment: quantity,
          },
        },
        select: {
          id: true,
          quantityOnHand: true,
          reservedQuantity: true,
        },
      });

      // 8. Generate transfer group ID
      const transferGroupId = crypto.randomUUID();

      // 9. Create paired stock movements
      const movements = await tx.stockMovement.createManyAndReturn({
        data: [
          {
            organizationId,
            productId: input.productId,
            warehouseId: input.sourceWarehouseId,
            actorId,
            type: "TRANSFER_OUT",
            quantity,
            reference: input.reference ?? null,
            transferGroupId,
            notes: input.notes ?? null,
          },
          {
            organizationId,
            productId: input.productId,
            warehouseId: input.destinationWarehouseId,
            actorId,
            type: "TRANSFER_IN",
            quantity,
            reference: input.reference ?? null,
            transferGroupId,
            notes: input.notes ?? null,
          },
        ],
      });

      return {
        product,
        sourceWarehouse,
        destinationWarehouse,
        sourceBalance: updatedSourceBalance,
        destinationBalance: updatedDestinationBalance,
        transferGroupId,
        movements,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

export async function stockAdjustment(
  organizationId: string,
  actorId: string,
  input: StockAdjustmentInput,
) {
  return prisma.$transaction(
    async (tx) => {
      // 1. Validate product
      const product = await tx.product.findFirst({
        where: {
          id: input.productId,
          organizationId,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          sku: true,
        },
      });

      if (!product) throw new Error("PRODUCT_NOT_FOUND");

      // 2. Validate warehouse
      const warehouse = await tx.warehouse.findFirst({
        where: {
          id: input.warehouseId,
          organizationId,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          code: true,
        },
      });

      if (!warehouse) throw new Error("WAREHOUSE_NOT_FOUND");

      const quantity = new Prisma.Decimal(input.quantity);

      // 3. Handle stock adjustment IN
      if (input.type === "IN") {
        const balance = await tx.inventoryBalance.upsert({
          where: {
            productId_warehouseId: {
              productId: input.productId,
              warehouseId: input.warehouseId,
            },
          },
          create: {
            organizationId,
            productId: input.productId,
            warehouseId: input.warehouseId,
            quantityOnHand: quantity,
            reservedQuantity: 0,
          },
          update: {
            quantityOnHand: {
              increment: quantity,
            },
          },
          select: {
            id: true,
            quantityOnHand: true,
            reservedQuantity: true,
          },
        });

        const movement = await tx.stockMovement.create({
          data: {
            organizationId,
            productId: input.productId,
            warehouseId: input.warehouseId,
            actorId,
            type: "ADJUSTMENT_IN",
            quantity,
            reference: input.reference ?? null,
            notes: input.notes ?? null,
          },
        });

        return {
          product,
          warehouse,
          balance,
          movement,
          adjustmentType: "ADJUSTMENT_IN" as const,
          availableStock: balance.quantityOnHand.minus(
            balance.reservedQuantity,
          ),
        };
      }

      // 4. Handle stock adjustment OUT
      const existingBalance = await tx.inventoryBalance.findFirst({
        where: {
          organizationId,
          productId: input.productId,
          warehouseId: input.warehouseId,
        },
        select: {
          id: true,
          quantityOnHand: true,
          reservedQuantity: true,
        },
      });

      if (!existingBalance) throw new Error("INSUFFICIENT_STOCK");

      const availableStock = existingBalance.quantityOnHand.minus(
        existingBalance.reservedQuantity,
      );

      if (availableStock.lessThan(quantity)) {
        throw new Error("INSUFFICIENT_STOCK");
      }

      const balance = await tx.inventoryBalance.update({
        where: {
          id: existingBalance.id,
        },
        data: {
          quantityOnHand: {
            decrement: quantity,
          },
        },
        select: {
          id: true,
          quantityOnHand: true,
          reservedQuantity: true,
        },
      });

      const movement = await tx.stockMovement.create({
        data: {
          organizationId,
          productId: input.productId,
          warehouseId: input.warehouseId,
          actorId,
          type: "ADJUSTMENT_OUT",
          quantity,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
        },
      });

      return {
        product,
        warehouse,
        balance,
        movement,
        adjustmentType: "ADJUSTMENT_OUT" as const,
        availableStock: balance.quantityOnHand.minus(balance.reservedQuantity),
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}
