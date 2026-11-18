import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission, AuthorizationError } from "@/lib/authorization";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const context = await requirePermission({
      stockMovement: ["read"],
    });

    const { id } = await params;

    if (!id?.trim()) {
      return NextResponse.json(
        { success: false, error: "Movement ID is required" },
        { status: 400 },
      );
    }

    const movement = await prisma.stockMovement.findFirst({
      where: {
        id,
        organizationId: context.organizationId,
      },
      include: {
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            description: true,
            unit: true,
            costPrice: true,
            sellingPrice: true,
          },
        },
        warehouse: {
          select: {
            id: true,
            name: true,
            code: true,
            address: true,
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
    });

    if (!movement) {
      return NextResponse.json(
        { success: false, error: "Stock movement not found" },
        { status: 404 },
      );
    }

    let transferPair = null;

    if (movement.transferGroupId) {
      transferPair = await prisma.stockMovement.findFirst({
        where: {
          transferGroupId: movement.transferGroupId,
          organizationId: context.organizationId,
          id: { not: movement.id },
        },
        include: {
          warehouse: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        ...movement,
        transferPair,
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.status },
      );
    }

    console.error("GET /api/inventory/movements/[id] error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to retrieve stock movement",
      },
      { status: 500 },
    );
  }
}
