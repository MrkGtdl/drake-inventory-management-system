import type { Prisma } from "@/generated/prisma/client";

export async function generateSku(
  tx: Prisma.TransactionClient,
  organizationId: string,
) {
  const counter = await tx.skuCounter.upsert({
    where: {
      organizationId,
    },
    create: {
      organizationId,
      lastValue: 1,
    },
    update: {
      lastValue: {
        increment: 1,
      },
    },
    select: {
      lastValue: true,
    },
  });

  return `SKU-${String(counter.lastValue).padStart(6, "0")}`;
}
