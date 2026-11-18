import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit-log";
import { AuthorizationError, requirePermission } from "@/lib/authorization";

const createSupplierSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2).max(150),
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
  isActive: z.boolean().default(true),
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

// GET: List suppliers
export async function GET(request: Request) {
  try {
    const context = await requirePermission({
      supplier: ["read"],
    });

    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search")?.trim();
    const status = searchParams.get("status") ?? "active";

    const page = Math.max(
      1,
      Number.parseInt(searchParams.get("page") ?? "1", 10) || 1,
    );

    const pageSize = Math.min(
      100,
      Math.max(
        1,
        Number.parseInt(searchParams.get("pageSize") ?? "10", 10) || 10,
      ),
    );

    const where = {
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
                code: {
                  contains: search,
                  mode: "insensitive" as const,
                },
              },
              {
                name: {
                  contains: search,
                  mode: "insensitive" as const,
                },
              },
              {
                contactPerson: {
                  contains: search,
                  mode: "insensitive" as const,
                },
              },
              {
                email: {
                  contains: search,
                  mode: "insensitive" as const,
                },
              },
              {
                phone: {
                  contains: search,
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {}),
    };

    const [suppliers, total] = await Promise.all([
      prisma.supplier.findMany({
        where,
        include: {
          _count: {
            select: {
              stockMovements: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),

      prisma.supplier.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: suppliers,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    const authorizationResponse = handleAuthorizationError(error);
    if (authorizationResponse) return authorizationResponse;

    console.error("Fetch suppliers failed:", error);

    return NextResponse.json(
      { success: false, error: "Unable to fetch suppliers" },
      { status: 500 },
    );
  }
}

// POST: Create supplier
export async function POST(request: Request) {
  try {
    const context = await requirePermission({
      supplier: ["create"],
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

    const validation = createSupplierSchema.safeParse(body);

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

    const supplier = await prisma.supplier.create({
      data: {
        organizationId: context.organizationId,
        ...validation.data,
      },
    });

    let auditLogRecorded = true;

    try {
      await createAuditLog({
        organizationId: context.organizationId,
        actorId: context.user.id,
        action: "SUPPLIER_CREATED",
        entity: "Supplier",
        entityId: supplier.id,
        description: `Supplier "${supplier.name}" was created`,
        metadata: {
          code: supplier.code,
          email: supplier.email,
        },
      });
    } catch (auditError) {
      auditLogRecorded = false;
      console.error("Supplier created, but audit logging failed:", auditError);
    }

    return NextResponse.json(
      {
        success: true,
        message: auditLogRecorded
          ? "Supplier created successfully"
          : "Supplier created, but the activity log could not be recorded",
        auditLogRecorded,
        data: supplier,
      },
      { status: 201 },
    );
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

    console.error("Create supplier failed:", error);

    return NextResponse.json(
      { success: false, error: "Unable to create supplier" },
      { status: 500 },
    );
  }
}
