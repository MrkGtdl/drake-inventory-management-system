import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";

import { requirePermission, AuthorizationError } from "@/lib/authorization";
import { createAuditLog } from "@/lib/audit-log";
import { stockAdjustment } from "@/lib/services/inventory.service";

const adjustmentSchema = z.object({
  productId: z.string().min(1),
  warehouseId: z.string().min(1),
  type: z.enum(["IN", "OUT"]),
  quantity: z
    .number()
    .positive()
    .max(999999999999999)
    .refine(
      (value) =>
        Number.isFinite(value * 1000) && Number.isInteger(value * 1000),
      "Quantity can have a maximum of 3 decimal places",
    ),
  reason: z.string().trim().min(3).max(500),
  reference: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export async function POST(request: NextRequest) {
  try {
    const context = await requirePermission({
      inventory: ["update"],
    });

    const body = await request.json();
    const validation = adjustmentSchema.safeParse(body);

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

    const input = validation.data;

    // Preserve the adjustment reason in movement history.
    const movementNotes = [
      `Reason: ${input.reason}`,
      input.notes ? `Notes: ${input.notes}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const result = await stockAdjustment(
      context.organizationId,
      context.user.id,
      {
        ...input,
        notes: movementNotes,
      },
    );

    let auditLogRecorded = false;

    try {
      await createAuditLog({
        organizationId: context.organizationId,
        actorId: context.user.id,
        action: "STOCK_ADJUSTMENT",
        entity: "StockMovement",
        entityId: result.movement.id,
        description: `${result.adjustmentType}: ${input.quantity} ${result.product.name} at ${result.warehouse.name}`,
        metadata: {
          productId: result.product.id,
          productSku: result.product.sku,
          warehouseId: result.warehouse.id,
          adjustmentType: result.adjustmentType,
          quantity: input.quantity,
          reason: input.reason,
          reference: input.reference ?? null,
        },
      });

      auditLogRecorded = true;
    } catch (auditError) {
      console.error("Stock Adjustment audit log error:", auditError);
    }

    return NextResponse.json(
      {
        success: true,
        message: "Stock adjusted successfully",
        auditLogRecorded,
        data: {
          movementId: result.movement.id,
          product: result.product,
          warehouse: result.warehouse,
          adjustmentType: result.adjustmentType,
          quantityAdjusted: result.movement.quantity.toString(),
          quantityOnHand: result.balance.quantityOnHand.toString(),
          reservedQuantity: result.balance.reservedQuantity.toString(),
          availableStock: result.availableStock.toString(),
          reason: input.reason,
          reference: input.reference ?? null,
          createdAt: result.movement.createdAt,
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

      if (error.message === "WAREHOUSE_NOT_FOUND") {
        return NextResponse.json(
          { success: false, error: "Warehouse not found or inactive" },
          { status: 404 },
        );
      }

      if (error.message === "INSUFFICIENT_STOCK") {
        return NextResponse.json(
          { success: false, error: "Insufficient available stock" },
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
          error:
            "Inventory changed during adjustment. Please retry the request.",
        },
        { status: 409 },
      );
    }

    console.error("Stock Adjustment API error:", error);

    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
