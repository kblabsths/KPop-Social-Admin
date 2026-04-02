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

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

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
