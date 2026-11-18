import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { createProduct } from "@/lib/services/product.service";
import { createAuditLog } from "@/lib/audit-log";
import { AuthorizationError, requirePermission } from "@/lib/authorization";

const createProductSchema = z.object({
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(2000).nullable().optional(),
  categoryId: z.string().trim().nullable().optional(),
  barcode: z.string().trim().max(100).nullable().optional(),
  unit: z.string().trim().min(1).max(30).default("pcs"),
  costPrice: z.number().finite().min(0).default(0),
  sellingPrice: z.number().finite().min(0).default(0),
  reorderLevel: z.number().finite().min(0).default(0),
  image: z.string().trim().max(1000).nullable().optional(),
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

export async function GET(request: Request) {
  try {
    const context = await requirePermission({
      product: ["read"],
    });

    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search")?.trim();
    const categoryId = searchParams.get("categoryId");
    const status = searchParams.get("status");

    const products = await prisma.product.findMany({
      where: {
        organizationId: context.organizationId,
        ...(status === "inactive"
          ? { isActive: false }
          : status === "all"
            ? {}
            : { isActive: true }),
        ...(categoryId ? { categoryId } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { sku: { contains: search, mode: "insensitive" } },
                { barcode: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
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
          select: {
            warehouseId: true,
            quantityOnHand: true,
            reservedQuantity: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json({
      success: true,
      data: products,
    });
  } catch (error) {
    const authorizationResponse = handleAuthorizationError(error);
    if (authorizationResponse) return authorizationResponse;

    console.error("Fetch products failed:", error);

    return NextResponse.json(
      { success: false, error: "Unable to fetch products" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const context = await requirePermission({
      product: ["create"],
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

    const validation = createProductSchema.safeParse(body);

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

    const product = await createProduct(
      context.organizationId,
      validation.data,
    );

    let auditLogRecorded = true;

    try {
      await createAuditLog({
        organizationId: context.organizationId,
        actorId: context.user.id,
        action: "PRODUCT_CREATED",
        entity: "Product",
        entityId: product.id,
        description: `Product "${product.name}" was created`,
        metadata: {
          sku: product.sku,
          categoryId: product.categoryId,
        },
      });
    } catch (auditError) {
      auditLogRecorded = false;
      console.error("Product created, but audit logging failed:", auditError);
    }

    return NextResponse.json(
      {
        success: true,
        message: auditLogRecorded
          ? "Product created successfully"
          : "Product created, but the activity log could not be recorded",
        auditLogRecorded,
        data: product,
      },
      { status: 201 },
    );
  } catch (error) {
    const authorizationResponse = handleAuthorizationError(error);
    if (authorizationResponse) return authorizationResponse;

    if (error instanceof Error && error.message === "INVALID_CATEGORY") {
      return NextResponse.json(
        { success: false, error: "Selected category is invalid" },
        { status: 400 },
      );
    }

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

    console.error("Create product failed:", error);

    return NextResponse.json(
      { success: false, error: "Unable to create product" },
      { status: 500 },
    );
  }
}
