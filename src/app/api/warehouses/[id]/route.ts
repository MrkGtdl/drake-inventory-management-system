import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit-log";
import { AuthorizationError, requirePermission } from "@/lib/authorization";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const updateWarehouseSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    code: z
      .string()
      .trim()
      .min(2)
      .max(20)
      .regex(/^[a-zA-Z0-9_-]+$/, "Invalid warehouse code")
      .optional(),
    address: z.string().trim().max(500).nullable().optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

function handleAuthorizationError(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: error.status },
    );
  }

  return null;
}

function isPrismaUniqueError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

// GET /api/warehouses/[id]
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const context = await requirePermission({
      warehouse: ["read"],
    });

    const { id } = await params;

    const warehouse = await prisma.warehouse.findFirst({
      where: {
        id,
        organizationId: context.organizationId,
      },
      include: {
        inventoryBalances: {
          where: {
            organizationId: context.organizationId,
          },
          include: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                unit: true,
                isActive: true,
              },
            },
          },
          orderBy: {
            updatedAt: "desc",
          },
        },
        stockMovements: {
          where: {
            organizationId: context.organizationId,
          },
          include: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
              },
            },
            actor: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: {
            createdAt: "desc",
          },
          take: 20,
        },
        _count: {
          select: {
            inventoryBalances: true,
            stockMovements: true,
          },
        },
      },
    });

    if (!warehouse) {
      return NextResponse.json(
        {
          success: false,
          error: "Warehouse not found",
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      data: warehouse,
    });
  } catch (error) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    console.error("GET /api/warehouses/[id] error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to retrieve warehouse",
      },
      { status: 500 },
    );
  }
}

// PATCH /api/warehouses/[id]
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const context = await requirePermission({
      warehouse: ["update"],
    });

    const { id } = await params;

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid JSON body",
        },
        { status: 400 },
      );
    }

    const validation = updateWarehouseSchema.safeParse(body);

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

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.warehouse.findFirst({
        where: {
          id,
          organizationId: context.organizationId,
          isActive: true,
        },
      });

      if (!existing) {
        return { status: "not_found" as const };
      }

      // Promote another warehouse before removing the current default.
      if (input.isDefault === false && existing.isDefault) {
        const replacement = await tx.warehouse.findFirst({
          where: {
            organizationId: context.organizationId,
            isActive: true,
            id: { not: id },
          },
          orderBy: {
            createdAt: "asc",
          },
        });

        if (!replacement) {
          return { status: "last_default" as const };
        }

        await tx.warehouse.update({
          where: { id: replacement.id },
          data: { isDefault: true },
        });
      }

      // Selecting this warehouse as default unsets the previous default.
      if (input.isDefault === true) {
        await tx.warehouse.updateMany({
          where: {
            organizationId: context.organizationId,
            isDefault: true,
            id: { not: id },
          },
          data: {
            isDefault: false,
          },
        });
      }

      const warehouse = await tx.warehouse.update({
        where: { id },
        data: {
          ...(input.name !== undefined && {
            name: input.name,
          }),
          ...(input.code !== undefined && {
            code: input.code.toUpperCase(),
          }),
          ...(input.address !== undefined && {
            address: input.address,
          }),
          ...(input.description !== undefined && {
            description: input.description,
          }),
          ...(input.isDefault !== undefined && {
            isDefault: input.isDefault,
          }),
        },
      });

      return {
        status: "success" as const,
        warehouse,
      };
    });

    if (result.status === "not_found") {
      return NextResponse.json(
        {
          success: false,
          error: "Active warehouse not found",
        },
        { status: 404 },
      );
    }

    if (result.status === "last_default") {
      return NextResponse.json(
        {
          success: false,
          error: "At least one default warehouse must be maintained",
        },
        { status: 409 },
      );
    }

    await createAuditLog({
      organizationId: context.organizationId,
      actorId: context.user.id,
      action: "WAREHOUSE_UPDATED",
      entity: "Warehouse",
      entityId: id,
      description: `Updated warehouse ${result.warehouse.name}`,
      metadata: {
        updatedFields: Object.keys(input),
      },
    });

    return NextResponse.json({
      success: true,
      message: "Warehouse updated successfully",
      data: result.warehouse,
    });
  } catch (error) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    if (isPrismaUniqueError(error)) {
      return NextResponse.json(
        {
          success: false,
          error: "A warehouse with this code already exists",
        },
        { status: 409 },
      );
    }

    console.error("PATCH /api/warehouses/[id] error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to update warehouse",
      },
      { status: 500 },
    );
  }
}

// DELETE /api/warehouses/[id]
export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const context = await requirePermission({
      warehouse: ["delete"],
    });

    const { id } = await params;

    const result = await prisma.$transaction(async (tx) => {
      const warehouse = await tx.warehouse.findFirst({
        where: {
          id,
          organizationId: context.organizationId,
          isActive: true,
        },
      });

      if (!warehouse) {
        return { status: "not_found" as const };
      }

      const activeWarehouseCount = await tx.warehouse.count({
        where: {
          organizationId: context.organizationId,
          isActive: true,
        },
      });

      if (activeWarehouseCount <= 1) {
        return { status: "last_warehouse" as const };
      }

      // Do not archive a warehouse with remaining or reserved stock.
      const stockBalanceCount = await tx.inventoryBalance.count({
        where: {
          organizationId: context.organizationId,
          warehouseId: id,
          OR: [
            { quantityOnHand: { not: 0 } },
            { reservedQuantity: { not: 0 } },
          ],
        },
      });

      if (stockBalanceCount > 0) {
        return { status: "has_stock" as const };
      }

      // Preserve warehouse movement history.
      const movementCount = await tx.stockMovement.count({
        where: {
          organizationId: context.organizationId,
          warehouseId: id,
        },
      });

      if (movementCount > 0) {
        return { status: "has_movements" as const };
      }

      // If this is the default, promote another active warehouse.
      if (warehouse.isDefault) {
        const replacement = await tx.warehouse.findFirst({
          where: {
            organizationId: context.organizationId,
            isActive: true,
            id: { not: id },
          },
          orderBy: {
            createdAt: "asc",
          },
        });

        if (replacement) {
          await tx.warehouse.update({
            where: { id: replacement.id },
            data: { isDefault: true },
          });
        }
      }

      await tx.warehouse.update({
        where: { id },
        data: {
          isActive: false,
          isDefault: false,
        },
      });

      return {
        status: "success" as const,
        warehouse,
      };
    });

    if (result.status === "not_found") {
      return NextResponse.json(
        {
          success: false,
          error: "Active warehouse not found",
        },
        { status: 404 },
      );
    }

    if (result.status === "last_warehouse") {
      return NextResponse.json(
        {
          success: false,
          error: "Cannot archive the last active warehouse",
        },
        { status: 409 },
      );
    }

    if (result.status === "has_stock") {
      return NextResponse.json(
        {
          success: false,
          error: "Cannot archive a warehouse with remaining or reserved stock",
        },
        { status: 409 },
      );
    }

    if (result.status === "has_movements") {
      return NextResponse.json(
        {
          success: false,
          error: "Cannot archive a warehouse with stock movement history",
        },
        { status: 409 },
      );
    }

    await createAuditLog({
      organizationId: context.organizationId,
      actorId: context.user.id,
      action: "WAREHOUSE_ARCHIVED",
      entity: "Warehouse",
      entityId: id,
      description: `Archived warehouse ${result.warehouse.name}`,
      metadata: {
        code: result.warehouse.code,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Warehouse archived successfully",
    });
  } catch (error) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    console.error("DELETE /api/warehouses/[id] error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to archive warehouse",
      },
      { status: 500 },
    );
  }
}
