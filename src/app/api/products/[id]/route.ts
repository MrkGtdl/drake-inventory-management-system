import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit-log";
import { AuthorizationError, requirePermission } from "@/lib/authorization";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const updateProductSchema = z
  .object({
    name: z.string().trim().min(2).max(150).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    categoryId: z.string().trim().nullable().optional(),
    barcode: z.string().trim().max(100).nullable().optional(),
    unit: z.string().trim().min(1).max(30).optional(),
    costPrice: z.number().finite().min(0).optional(),
    sellingPrice: z.number().finite().min(0).optional(),
    reorderLevel: z.number().finite().min(0).optional(),
    image: z.string().trim().max(1000).nullable().optional(),
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

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const context = await requirePermission({
      product: ["read"],
    });

    const { id } = await params;

    const product = await prisma.product.findFirst({
      where: {
        id,
        organizationId: context.organizationId,
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
        inventoryBalances: {
          where: {
            organizationId: context.organizationId,
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
        },
        stockMovements: {
          where: {
            organizationId: context.organizationId,
          },
          orderBy: {
            createdAt: "desc",
          },
          take: 20,
        },
      },
    });

    if (!product) {
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      data: product,
    });
  } catch (error) {
    const authorizationResponse = handleAuthorizationError(error);
    if (authorizationResponse) return authorizationResponse;

    console.error("Fetch product failed:", error);

    return NextResponse.json(
      { success: false, error: "Unable to fetch product" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const context = await requirePermission({
      product: ["update"],
    });

    const { id } = await params;

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON request body" },
        { status: 400 },
      );
    }

    const validation = updateProductSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid product data",
          details: validation.error.flatten(),
        },
        { status: 400 },
      );
    }

    const existingProduct = await prisma.product.findFirst({
      where: {
        id,
        organizationId: context.organizationId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!existingProduct) {
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 },
      );
    }

    const { categoryId, ...fields } = validation.data;

    if (categoryId) {
      const category = await prisma.productCategory.findFirst({
        where: {
          id: categoryId,
          organizationId: context.organizationId,
          isActive: true,
        },
        select: { id: true },
      });

      if (!category) {
        return NextResponse.json(
          { success: false, error: "Selected category is invalid" },
          { status: 400 },
        );
      }
    }

    const updated = await prisma.product.updateMany({
      where: {
        id,
        organizationId: context.organizationId,
        isActive: true,
      },
      data: {
        ...fields,
        ...(categoryId !== undefined ? { categoryId } : {}),
      },
    });

    if (updated.count === 0) {
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 },
      );
    }

    const product = await prisma.product.findFirst({
      where: {
        id,
        organizationId: context.organizationId,
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    try {
      await createAuditLog({
        organizationId: context.organizationId,
        actorId: context.user.id,
        action: "PRODUCT_UPDATED",
        entity: "Product",
        entityId: id,
        description: `Product "${product?.name ?? existingProduct.name}" was updated`,
        metadata: {
          updatedFields: Object.keys(validation.data),
        },
      });
    } catch (auditError) {
      console.error("Product updated, but audit logging failed:", auditError);
    }

    return NextResponse.json({
      success: true,
      message: "Product updated successfully",
      data: product,
    });
  } catch (error) {
    const authorizationResponse = handleAuthorizationError(error);
    if (authorizationResponse) return authorizationResponse;

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { success: false, error: "A product with this barcode already exists" },
        { status: 409 },
      );
    }

    console.error("Update product failed:", error);

    return NextResponse.json(
      { success: false, error: "Unable to update product" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const context = await requirePermission({
      product: ["delete"],
    });

    const { id } = await params;

    const product = await prisma.product.findFirst({
      where: {
        id,
        organizationId: context.organizationId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!product) {
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 },
      );
    }

    await prisma.product.updateMany({
      where: {
        id,
        organizationId: context.organizationId,
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });

    try {
      await createAuditLog({
        organizationId: context.organizationId,
        actorId: context.user.id,
        action: "PRODUCT_ARCHIVED",
        entity: "Product",
        entityId: id,
        description: `Product "${product.name}" was archived`,
      });
    } catch (auditError) {
      console.error("Product archived, but audit logging failed:", auditError);
    }

    return NextResponse.json({
      success: true,
      message: "Product archived successfully",
    });
  } catch (error) {
    const authorizationResponse = handleAuthorizationError(error);
    if (authorizationResponse) return authorizationResponse;

    console.error("Archive product failed:", error);

    return NextResponse.json(
      { success: false, error: "Unable to archive product" },
      { status: 500 },
    );
  }
}
