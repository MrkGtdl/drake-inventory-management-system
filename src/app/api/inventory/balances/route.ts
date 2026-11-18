import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requirePermission, AuthorizationError } from "@/lib/authorization";
import { unstable_rethrow } from "next/navigation";

const querySchema = z.object({
  search: z.string().trim().max(100).optional(),
  productId: z.string().trim().min(1).optional(),
  warehouseId: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

export async function GET(request: NextRequest) {
  try {
    const context = await requirePermission(
      { inventory: ["read"] },
      request.headers,
    );

    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const validation = querySchema.safeParse(params);

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid query parameters",
          details: validation.error.flatten(),
        },
        { status: 400 },
      );
    }

    const { search, productId, warehouseId, page, limit, sortOrder } =
      validation.data;

    const where = {
      organizationId: context.organizationId,

      ...(productId ? { productId } : {}),
      ...(warehouseId ? { warehouseId } : {}),

      ...(search
        ? {
            OR: [
              {
                product: {
                  name: {
                    contains: search,
                    mode: "insensitive" as const,
                  },
                },
              },
              {
                product: {
                  sku: {
                    contains: search,
                    mode: "insensitive" as const,
                  },
                },
              },
              {
                warehouse: {
                  name: {
                    contains: search,
                    mode: "insensitive" as const,
                  },
                },
              },
              {
                warehouse: {
                  code: {
                    contains: search,
                    mode: "insensitive" as const,
                  },
                },
              },
            ],
          }
        : {}),
    };

    const skip = (page - 1) * limit;

    const [balances, total] = await Promise.all([
      prisma.inventoryBalance.findMany({
        where,
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              unit: true,
              reorderLevel: true,
              isActive: true,
            },
          },
          warehouse: {
            select: {
              id: true,
              name: true,
              code: true,
              isActive: true,
              isDefault: true,
            },
          },
        },
        orderBy: [
          { product: { name: sortOrder } },
          { warehouse: { name: "asc" } },
        ],
        skip,
        take: limit,
      }),

      prisma.inventoryBalance.count({ where }),
    ]);

    const data = balances.map((balance) => {
      const quantityOnHand = Number(balance.quantityOnHand);
      const reservedQuantity = Number(balance.reservedQuantity);

      return {
        id: balance.id,
        organizationId: balance.organizationId,
        productId: balance.productId,
        warehouseId: balance.warehouseId,

        product: balance.product,
        warehouse: balance.warehouse,

        quantityOnHand,
        reservedQuantity,
        availableStock: quantityOnHand - reservedQuantity,

        createdAt: balance.createdAt,
        updatedAt: balance.updatedAt,
      };
    });

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    });
  } catch (error) {
    unstable_rethrow(error);

    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.status },
      );
    }

    console.error("GET /api/inventory/balances error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to retrieve inventory balances",
      },
      { status: 500 },
    );
  }
}
