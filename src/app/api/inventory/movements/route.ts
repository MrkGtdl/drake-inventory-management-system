import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requirePermission, AuthorizationError } from "@/lib/authorization";
import { unstable_rethrow } from "next/navigation";

const movementTypes = [
  "PURCHASE_RECEIPT",
  "SALE",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
  "RETURN_IN",
  "RETURN_OUT",
] as const;

const querySchema = z.object({
  search: z.string().trim().max(100).optional(),
  productId: z.string().trim().min(1).optional(),
  warehouseId: z.string().trim().min(1).optional(),
  type: z.enum(movementTypes).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

function parseDate(value: string, endOfDay = false) {
  const date = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+08:00`
      : value,
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: NextRequest) {
  try {
    const context = await requirePermission(
      { stockMovement: ["read"] },
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

    const {
      search,
      productId,
      warehouseId,
      type,
      startDate,
      endDate,
      page,
      limit,
      sortOrder,
    } = validation.data;

    const start = startDate ? parseDate(startDate) : null;
    const end = endDate ? parseDate(endDate, true) : null;

    if (
      (startDate && !start) ||
      (endDate && !end) ||
      (start && end && start > end)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid date range",
        },
        { status: 400 },
      );
    }

    const where = {
      organizationId: context.organizationId,

      ...(productId ? { productId } : {}),
      ...(warehouseId ? { warehouseId } : {}),
      ...(type ? { type } : {}),

      ...(search
        ? {
            OR: [
              {
                product: {
                  name: { contains: search, mode: "insensitive" as const },
                },
              },
              {
                product: {
                  sku: { contains: search, mode: "insensitive" as const },
                },
              },
              {
                reference: {
                  contains: search,
                  mode: "insensitive" as const,
                },
              },
              {
                notes: {
                  contains: search,
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {}),

      ...(start || end
        ? {
            createdAt: {
              ...(start ? { gte: start } : {}),
              ...(end ? { lte: end } : {}),
            },
          }
        : {}),
    };

    const skip = (page - 1) * limit;

    const [movements, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              unit: true,
            },
          },
          warehouse: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          actor: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: {
          createdAt: sortOrder,
        },
        skip,
        take: limit,
      }),

      prisma.stockMovement.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      success: true,
      data: movements,
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

    console.error("GET /api/inventory/movements error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to retrieve stock movements",
      },
      { status: 500 },
    );
  }
}
