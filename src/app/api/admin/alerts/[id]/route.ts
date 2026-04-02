import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";
import type { NextRequest } from "next/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { id } = await params;
  const body = await request.json();

  const alert = await prisma.dataQualityAlert.findUnique({ where: { id } });
  if (!alert) {
    return Response.json({ error: "Alert not found" }, { status: 404 });
  }

  const updated = await prisma.dataQualityAlert.update({
    where: { id },
    data: {
      resolvedAt: body.resolved ? new Date() : null,
    },
  });

  return Response.json(updated);
}
