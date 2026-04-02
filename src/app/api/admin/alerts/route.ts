import { prisma } from "@/lib/prisma";
import { requireAdmin, paginationParams } from "@/lib/admin";
import { NextRequest } from "next/server";
import { AlertType, AlertSeverity } from "@/generated/prisma/client";

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { searchParams } = request.nextUrl;
  const { page, pageSize, skip } = paginationParams(searchParams);
  const alertType = searchParams.get("type") as AlertType | null;
  const severity = searchParams.get("severity") as AlertSeverity | null;
  const resolved = searchParams.get("resolved");

  const where = {
    ...(alertType ? { alertType } : {}),
    ...(severity ? { severity } : {}),
    ...(resolved === "true"
      ? { resolvedAt: { not: null } }
      : resolved === "false"
        ? { resolvedAt: null }
        : {}),
  };

  const [data, total] = await Promise.all([
    prisma.dataQualityAlert.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.dataQualityAlert.count({ where }),
  ]);

  return Response.json({ data, total, page, pageSize });
}
