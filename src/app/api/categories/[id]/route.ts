import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit-log";
import { AuthorizationError, requirePermission } from "@/lib/authorization";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const updateCategorySchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
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

// GET /api/categories/[id]
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const context = await requirePermission({
      category: ["read"],
    });

    const { id } = await params;

    const category = await prisma.productCategory.findFirst({
      where: {
        id,
        organizationId: context.organizationId,
      },
    });

    if (!category) {
      return NextResponse.json(
        { success: false, error: "Category not found" },
        { status: 404 },
      );
    }

    const activeProductCount = await prisma.product.count({
      where: {
        categoryId: id,
        organizationId: context.organizationId,
        isActive: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        ...category,
        activeProductCount,
      },
    });
  } catch (error) {
    const authorizationResponse = handleAuthorizationError(error);
    if (authorizationResponse) return authorizationResponse;

    console.error("Fetch category failed:", error);

    return NextResponse.json(
      { success: false, error: "Unable to fetch category" },
      { status: 500 },
    );
  }
}

// PATCH /api/categories/[id]
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const context = await requirePermission({
      category: ["update"],
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

    const validation = updateCategorySchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid category data",
          details: validation.error.flatten(),
        },
        { status: 400 },
      );
    }

    const existingCategory = await prisma.productCategory.findFirst({
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

    if (!existingCategory) {
      return NextResponse.json(
        { success: false, error: "Category not found" },
        { status: 404 },
      );
    }

    const updated = await prisma.productCategory.updateMany({
      where: {
        id,
        organizationId: context.organizationId,
        isActive: true,
      },
      data: validation.data,
    });

    if (updated.count === 0) {
      return NextResponse.json(
        { success: false, error: "Category not found" },
        { status: 404 },
      );
    }

    const category = await prisma.productCategory.findFirst({
      where: {
        id,
        organizationId: context.organizationId,
      },
    });

    try {
      await createAuditLog({
        organizationId: context.organizationId,
        actorId: context.user.id,
        action: "CATEGORY_UPDATED",
        entity: "ProductCategory",
        entityId: id,
        description: `Category "${category?.name ?? existingCategory.name}" was updated`,
        metadata: {
          updatedFields: Object.keys(validation.data),
        },
      });
    } catch (auditError) {
      console.error("Category updated, but audit logging failed:", auditError);
    }

    return NextResponse.json({
      success: true,
      message: "Category updated successfully",
      data: category,
    });
  } catch (error) {
    const authorizationResponse = handleAuthorizationError(error);
    if (authorizationResponse) return authorizationResponse;

    if (isPrismaUniqueError(error)) {
      return NextResponse.json(
        { success: false, error: "A category with this name already exists" },
        { status: 409 },
      );
    }

    console.error("Update category failed:", error);

    return NextResponse.json(
      { success: false, error: "Unable to update category" },
      { status: 500 },
    );
  }
}

// DELETE /api/categories/[id]
export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const context = await requirePermission({
      category: ["delete"],
    });

    const { id } = await params;

    const category = await prisma.productCategory.findFirst({
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

    if (!category) {
      return NextResponse.json(
        { success: false, error: "Category not found" },
        { status: 404 },
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const activeProductCount = await tx.product.count({
        where: {
          categoryId: id,
          organizationId: context.organizationId,
          isActive: true,
        },
      });

      if (activeProductCount > 0) {
        return {
          archived: false,
          activeProductCount,
        };
      }

      const updated = await tx.productCategory.updateMany({
        where: {
          id,
          organizationId: context.organizationId,
          isActive: true,
        },
        data: {
          isActive: false,
        },
      });

      return {
        archived: updated.count > 0,
        activeProductCount: 0,
      };
    });

    if (!result.archived) {
      if (result.activeProductCount > 0) {
        return NextResponse.json(
          {
            success: false,
            error: "Cannot archive a category with active products",
            activeProductCount: result.activeProductCount,
          },
          { status: 409 },
        );
      }

      return NextResponse.json(
        { success: false, error: "Category not found" },
        { status: 404 },
      );
    }

    try {
      await createAuditLog({
        organizationId: context.organizationId,
        actorId: context.user.id,
        action: "CATEGORY_ARCHIVED",
        entity: "ProductCategory",
        entityId: id,
        description: `Category "${category.name}" was archived`,
      });
    } catch (auditError) {
      console.error("Category archived, but audit logging failed:", auditError);
    }

    return NextResponse.json({
      success: true,
      message: "Category archived successfully",
    });
  } catch (error) {
    const authorizationResponse = handleAuthorizationError(error);
    if (authorizationResponse) return authorizationResponse;

    console.error("Archive category failed:", error);

    return NextResponse.json(
      { success: false, error: "Unable to archive category" },
      { status: 500 },
    );
  }
}
