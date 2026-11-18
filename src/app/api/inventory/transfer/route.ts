import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";

import { requirePermission, AuthorizationError } from "@/lib/authorization";
import { createAuditLog } from "@/lib/audit-log";
import { stockTransfer } from "@/lib/services/inventory.service";

const transferSchema = z
  .object({
    productId: z.string().min(1),
    sourceWarehouseId: z.string().min(1),
    destinationWarehouseId: z.string().min(1),
    quantity: z
      .number()
      .positive()
      .max(999999999999999)
      .refine(
        (value) =>
          Number.isFinite(value * 1000) && Number.isInteger(value * 1000),
        "Quantity can have a maximum of 3 decimal places",
      ),
    reference: z.string().trim().max(100).optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
  })
  .refine((data) => data.sourceWarehouseId !== data.destinationWarehouseId, {
    message: "Source and destination warehouses must be different",
    path: ["destinationWarehouseId"],
  });

export async function POST(request: NextRequest) {
  try {
    const context = await requirePermission({
      stockMovement: ["create"],
    });

    const body = await request.json();
    const validation = transferSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Validation failed",
          details: validation.error.flatten(),
        },
        { status: 400 },
      );
    }

    const result = await stockTransfer(
      context.organizationId,
      context.user.id,
      validation.data,
    );

    let auditLogRecorded = false;

    try {
      await createAuditLog({
        organizationId: context.organizationId,
        actorId: context.user.id,
        action: "STOCK_TRANSFER",
        entity: "StockMovement",
        entityId: result.transferGroupId,
        description: `Transferred ${validation.data.quantity} ${result.product.name} from ${result.sourceWarehouse.name} to ${result.destinationWarehouse.name}`,
        metadata: {
          transferGroupId: result.transferGroupId,
          productId: result.product.id,
          productSku: result.product.sku,
          sourceWarehouseId: result.sourceWarehouse.id,
          destinationWarehouseId: result.destinationWarehouse.id,
          quantity: validation.data.quantity,
          reference: validation.data.reference ?? null,
        },
      });

      auditLogRecorded = true;
    } catch (auditError) {
      console.error("Stock Transfer audit log error:", auditError);
    }

    return NextResponse.json(
      {
        success: true,
        message: "Stock transferred successfully",
        auditLogRecorded,
        data: {
          transferGroupId: result.transferGroupId,
          product: result.product,
          sourceWarehouse: result.sourceWarehouse,
          destinationWarehouse: result.destinationWarehouse,
          quantityTransferred: validation.data.quantity,
          sourceQuantityOnHand: result.sourceBalance.quantityOnHand.toString(),
          destinationQuantityOnHand:
            result.destinationBalance.quantityOnHand.toString(),
          movements: result.movements.map((movement) => ({
            id: movement.id,
            type: movement.type,
            warehouseId: movement.warehouseId,
            quantity: movement.quantity.toString(),
            reference: movement.reference,
            createdAt: movement.createdAt,
          })),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.status },
      );
    }

    if (error instanceof Error) {
      if (error.message === "PRODUCT_NOT_FOUND") {
        return NextResponse.json(
          { success: false, error: "Product not found or inactive" },
          { status: 404 },
        );
      }

      if (error.message === "SOURCE_WAREHOUSE_NOT_FOUND") {
        return NextResponse.json(
          { success: false, error: "Source warehouse not found or inactive" },
          { status: 404 },
        );
      }

      if (error.message === "DESTINATION_WAREHOUSE_NOT_FOUND") {
        return NextResponse.json(
          {
            success: false,
            error: "Destination warehouse not found or inactive",
          },
          { status: 404 },
        );
      }

      if (error.message === "SAME_WAREHOUSE") {
        return NextResponse.json(
          {
            success: false,
            error: "Source and destination warehouses must be different",
          },
          { status: 400 },
        );
      }

      if (error.message === "INSUFFICIENT_STOCK") {
        return NextResponse.json(
          {
            success: false,
            error: "Insufficient available stock in source warehouse",
          },
          { status: 409 },
        );
      }
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Inventory changed during transfer. Please retry the request.",
        },
        { status: 409 },
      );
    }

    console.error("Stock Transfer API error:", error);

    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
