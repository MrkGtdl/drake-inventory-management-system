import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit-log";
import { AuthorizationError, requirePermission } from "@/lib/authorization";

const createCategorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).nullable().optional(),
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

// GET /api/categories
export async function GET(request: Request) {
  try {
    const context = await requirePermission({
      category: ["read"],
    });

    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search")?.trim();
    const status = searchParams.get("status");

    const categories = await prisma.productCategory.findMany({
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
                  description: {
                    contains: search,
                    mode: "insensitive",
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json({
      success: true,
      data: categories,
    });
  } catch (error) {
    const authorizationResponse = handleAuthorizationError(error);
    if (authorizationResponse) return authorizationResponse;

    console.error("Fetch categories failed:", error);

    return NextResponse.json(
      { success: false, error: "Unable to fetch categories" },
      { status: 500 },
    );
  }
}

// POST /api/categories
export async function POST(request: Request) {
  try {
    const context = await requirePermission({
      category: ["create"],
    });

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON request body" },
        { status: 400 },
      );
    }

    const validation = createCategorySchema.safeParse(body);

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

    const category = await prisma.productCategory.create({
      data: {
        organizationId: context.organizationId,
        name: validation.data.name,
        description: validation.data.description ?? null,
      },
    });

    let auditLogRecorded = true;

    try {
      await createAuditLog({
        organizationId: context.organizationId,
        actorId: context.user.id,
        action: "CATEGORY_CREATED",
        entity: "ProductCategory",
        entityId: category.id,
        description: `Category "${category.name}" was created`,
      });
    } catch (auditError) {
      auditLogRecorded = false;
      console.error("Category created, but audit logging failed:", auditError);
    }

    return NextResponse.json(
      {
        success: true,
        message: auditLogRecorded
          ? "Category created successfully"
          : "Category created, but the activity log could not be recorded",
        auditLogRecorded,
        data: category,
      },
      { status: 201 },
    );
  } catch (error) {
    const authorizationResponse = handleAuthorizationError(error);
    if (authorizationResponse) return authorizationResponse;

    if (isPrismaUniqueError(error)) {
      return NextResponse.json(
        { success: false, error: "A category with this name already exists" },
        { status: 409 },
      );
    }

    console.error("Create category failed:", error);

    return NextResponse.json(
      { success: false, error: "Unable to create category" },
      { status: 500 },
    );
  }
}
