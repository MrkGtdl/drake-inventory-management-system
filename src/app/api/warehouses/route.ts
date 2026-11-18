import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit-log";
import { AuthorizationError, requirePermission } from "@/lib/authorization";
import { createWarehouse } from "@/lib/services/warehouse.service";

const createWarehouseSchema = z.object({
  name: z.string().trim().min(2).max(100),
  code: z
    .string()
    .trim()
    .min(2)
    .max(20)
    .regex(/^[a-zA-Z0-9_-]+$/, "Invalid warehouse code"),
  address: z.string().trim().max(500).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  isDefault: z.boolean().optional(),
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

// GET /api/warehouses
export async function GET(request: Request) {
  try {
    const context = await requirePermission({
      warehouse: ["read"],
    });

    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search")?.trim();
    const status = searchParams.get("status") ?? "active";

    const warehouses = await prisma.warehouse.findMany({
      where: {
        organizationId: context.organizationId,

        ...(status === "inactive"
          ? { isActive: false }
          : status === "all"
            ? {}
            : { isActive: true }),

        ...(search
          ? {
              OR: [
                {
                  name: {
                    contains: search,
                    mode: "insensitive",
                  },
                },
                {
                  code: {
                    contains: search,
                    mode: "insensitive",
                  },
                },
                {
                  address: {
                    contains: search,
                    mode: "insensitive",
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        _count: {
          select: {
            inventoryBalances: true,
            stockMovements: true,
          },
        },
      },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });

    return NextResponse.json({
      success: true,
      data: warehouses,
    });
  } catch (error) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    console.error("GET /api/warehouses error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to retrieve warehouses",
      },
      { status: 500 },
    );
  }
}

// POST /api/warehouses
export async function POST(request: Request) {
  try {
    const context = await requirePermission({
      warehouse: ["create"],
    });

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

    const validation = createWarehouseSchema.safeParse(body);

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

    const warehouse = await createWarehouse(
      context.organizationId,
      validation.data,
    );

    await createAuditLog({
      organizationId: context.organizationId,
      actorId: context.user.id,
      action: "WAREHOUSE_CREATED",
      entity: "Warehouse",
      entityId: warehouse.id,
      description: `Created warehouse ${warehouse.name}`,
      metadata: {
        name: warehouse.name,
        code: warehouse.code,
        isDefault: warehouse.isDefault,
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: "Warehouse created successfully",
        auditLogRecorded: true,
        data: warehouse,
      },
      { status: 201 },
    );
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

    console.error("POST /api/warehouses error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to create warehouse",
      },
      { status: 500 },
    );
  }
}
