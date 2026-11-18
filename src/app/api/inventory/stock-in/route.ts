import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { AuthorizationError, requirePermission } from "@/lib/authorization";

import { createAuditLog } from "@/lib/audit-log";
import { stockIn } from "@/lib/services/inventory.service";

const stockInSchema = z.object({
  productId: z.string().min(1),
  warehouseId: z.string().min(1),

  quantity: z
    .number()
    .positive()
    .max(999999999999999)
    .refine(
      (value) => Number.isInteger(value * 1000),
      "Quantity must have at most 3 decimal places",
    ),

  unitCost: z
    .number()
    .nonnegative()
    .max(9999999999999999)
    .refine(
      (value) => Number.isInteger(value * 100),
      "Unit cost must have at most 2 decimal places",
    )
    .nullable()
    .optional(),

  reference: z.string().trim().max(100).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const context = await requirePermission({
      stockMovement: ["create"],
    });

    const body = await request.json();
    const validation = stockInSchema.safeParse(body);

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

    const result = await stockIn(
      context.organizationId,
      context.user.id,
      validation.data,
    );

    let auditLogRecorded = true;

    try {
      await createAuditLog({
        organizationId: context.organizationId,
        actorId: context.user.id,
        action: "STOCK_IN",
        entity: "StockMovement",
        entityId: result.movement.id,
        description: `Received ${validation.data.quantity} units of ${result.product.name} into ${result.warehouse.name}`,
        metadata: {
          productId: result.product.id,
          productSku: result.product.sku,
          warehouseId: result.warehouse.id,
          warehouseCode: result.warehouse.code,
          quantity: validation.data.quantity,
          unitCost: validation.data.unitCost ?? null,
          reference: validation.data.reference ?? null,
        },
        ipAddress: request.headers.get("x-forwarded-for") ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
      });
    } catch (error) {
      auditLogRecorded = false;
      console.error("Stock In audit log failed:", error);
    }

    return NextResponse.json(
      {
        success: true,
        message: "Stock received successfully",
        auditLogRecorded,
        data: {
          movementId: result.movement.id,
          product: result.product,
          warehouse: result.warehouse,
          quantityReceived: result.movement.quantity.toString(),
          quantityOnHand: result.balance.quantityOnHand.toString(),
          unitCost: result.movement.unitCost?.toString() ?? null,
          reference: result.movement.reference,
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
    }

    console.error("Stock In API error:", error);

    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
