import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit-log";
import { AuthorizationError, requirePermission } from "@/lib/authorization";

const updateSupplierSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(50)
      .transform((value) => value.toUpperCase())
      .optional(),

    name: z.string().trim().min(2).max(150).optional(),
    contactPerson: z.string().trim().max(150).nullable().optional(),
    email: z.string().trim().email().max(255).nullable().optional(),
    phone: z.string().trim().max(50).nullable().optional(),
    website: z.string().trim().url().max(255).nullable().optional(),

    address: z.string().trim().max(255).nullable().optional(),
    city: z.string().trim().max(100).nullable().optional(),
    state: z.string().trim().max(100).nullable().optional(),
    postalCode: z.string().trim().max(30).nullable().optional(),
    country: z.string().trim().max(100).nullable().optional(),

    taxId: z.string().trim().max(100).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function handleAuthorizationError(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: error.status },
    );
  }

  return null;
}

// GET: Get supplier details
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const context = await requirePermission({
      supplier: ["read"],
    });

    const { id } = await params;

    const supplier = await prisma.supplier.findFirst({
      where: {
        id,
        organizationId: context.organizationId,
      },
      include: {
        _count: {
          select: {
            stockMovements: true,
          },
        },
        stockMovements: {
          orderBy: {
            createdAt: "desc",
          },
          take: 10,
          select: {
            id: true,
            type: true,
            quantity: true,
            reference: true,
            createdAt: true,
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
              },
            },
            warehouse: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
          },
        },
      },
    });

    if (!supplier) {
      return NextResponse.json(
        { success: false, error: "Supplier not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      data: supplier,
    });
  } catch (error) {
    const authorizationResponse = handleAuthorizationError(error);
    if (authorizationResponse) return authorizationResponse;

    console.error("Fetch supplier failed:", error);

    return NextResponse.json(
      { success: false, error: "Unable to fetch supplier" },
      { status: 500 },
    );
  }
}

// PATCH: Update supplier
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const context = await requirePermission({
      supplier: ["update"],
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

    const validation = updateSupplierSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid supplier data",
          details: validation.error.flatten(),
        },
        { status: 400 },
      );
    }

    const existingSupplier = await prisma.supplier.findFirst({
      where: {
        id,
        organizationId: context.organizationId,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!existingSupplier) {
      return NextResponse.json(
        { success: false, error: "Supplier not found" },
        { status: 404 },
      );
    }

    const supplier = await prisma.supplier.update({
      where: {
        id: existingSupplier.id,
      },
      data: validation.data,
    });

    let auditLogRecorded = true;

    try {
      await createAuditLog({
        organizationId: context.organizationId,
        actorId: context.user.id,
        action: "SUPPLIER_UPDATED",
        entity: "Supplier",
        entityId: supplier.id,
        description: `Supplier "${supplier.name}" was updated`,
        metadata: {
          updatedFields: Object.keys(validation.data),
        },
      });
    } catch (auditError) {
      auditLogRecorded = false;
      console.error("Supplier updated, but audit logging failed:", auditError);
    }

    return NextResponse.json({
      success: true,
      message: auditLogRecorded
        ? "Supplier updated successfully"
        : "Supplier updated, but the activity log could not be recorded",
      auditLogRecorded,
      data: supplier,
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
        {
          success: false,
          error: "A supplier with this code already exists",
        },
        { status: 409 },
      );
    }

    console.error("Update supplier failed:", error);

    return NextResponse.json(
      { success: false, error: "Unable to update supplier" },
      { status: 500 },
    );
  }
}

// DELETE: Delete supplier
export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const context = await requirePermission({
      supplier: ["delete"],
    });

    const { id } = await params;

    const existingSupplier = await prisma.supplier.findFirst({
      where: {
        id,
        organizationId: context.organizationId,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!existingSupplier) {
      return NextResponse.json(
        { success: false, error: "Supplier not found" },
        { status: 404 },
      );
    }

    // Prevent deletion when supplier has stock movement history.
    const movementCount = await prisma.stockMovement.count({
      where: {
        organizationId: context.organizationId,
        supplierId: existingSupplier.id,
      },
    });

    if (movementCount > 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Supplier cannot be deleted because it has stock movement history",
          details: {
            stockMovements: movementCount,
          },
        },
        { status: 409 },
      );
    }

    await prisma.supplier.delete({
      where: {
        id: existingSupplier.id,
      },
    });

    let auditLogRecorded = true;

    try {
      await createAuditLog({
        organizationId: context.organizationId,
        actorId: context.user.id,
        action: "SUPPLIER_DELETED",
        entity: "Supplier",
        entityId: existingSupplier.id,
        description: `Supplier "${existingSupplier.name}" was deleted`,
        metadata: {
          supplierName: existingSupplier.name,
        },
      });
    } catch (auditError) {
      auditLogRecorded = false;
      console.error("Supplier deleted, but audit logging failed:", auditError);
    }

    return NextResponse.json({
      success: true,
      message: auditLogRecorded
        ? "Supplier deleted successfully"
        : "Supplier deleted, but the activity log could not be recorded",
      auditLogRecorded,
    });
  } catch (error) {
    const authorizationResponse = handleAuthorizationError(error);
    if (authorizationResponse) return authorizationResponse;

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2003"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Supplier cannot be deleted because it is referenced by other records",
        },
        { status: 409 },
      );
    }

    console.error("Delete supplier failed:", error);

    return NextResponse.json(
      { success: false, error: "Unable to delete supplier" },
      { status: 500 },
    );
  }
}
