import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { AppPermissions } from "@/lib/permissions";

export class AuthorizationError extends Error {
  constructor(
    public status: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

async function getAuthenticatedUser(requestHeaders?: Headers) {
  // Use incoming request headers when supplied.
  // Fall back to next/headers for existing callers.
  const resolvedHeaders = requestHeaders ?? (await headers());

  const session = await auth.api.getSession({
    headers: resolvedHeaders,
  });

  if (!session) {
    throw new AuthorizationError(401, "Unauthorized");
  }

  // Always get the current platform role from the database.
  const user = await prisma.user.findUnique({
    where: {
      id: session.user.id,
    },
    select: {
      platformRole: true,
    },
  });

  return {
    requestHeaders: resolvedHeaders,
    session,
    isSuperadmin: user?.platformRole === "superadmin",
  };
}

export async function requirePermission(
  permissions: AppPermissions,
  requestHeaders?: Headers,
) {
  const {
    requestHeaders: resolvedHeaders,
    session,
    isSuperadmin,
  } = await getAuthenticatedUser(requestHeaders);

  const organizationId = session.session.activeOrganizationId;

  if (!organizationId) {
    throw new AuthorizationError(403, "No active organization selected");
  }

  // Platform superadmins bypass organization-level permission checks.
  if (isSuperadmin) {
    return {
      user: session.user,
      session: session.session,
      organizationId,
    };
  }

  // Regular users must pass Better Auth permission checks.
  const result = await auth.api.hasPermission({
    headers: resolvedHeaders,
    body: {
      permissions,
    },
  });

  if (!result.success) {
    throw new AuthorizationError(403, "Insufficient permissions");
  }

  return {
    user: session.user,
    session: session.session,
    organizationId,
  };
}

export async function requireSuperadmin(requestHeaders?: Headers) {
  const { session, isSuperadmin } = await getAuthenticatedUser(requestHeaders);

  if (!isSuperadmin) {
    throw new AuthorizationError(403, "Superadmin access required");
  }

  return {
    user: session.user,
    session: session.session,
  };
}
