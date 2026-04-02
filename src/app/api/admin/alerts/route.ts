import { prisma } from "@/lib/prisma";
import { requireAdmin, paginationParams } from "@/lib/admin";
import { NextRequest } from "next/server";
import { AlertType, AlertSeverity } from "@/generated/prisma/client";

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { searchParams } = request.nextUrl;
  const { page, pageSize, skip } = paginationParams(searchParams);
  const typeParam = searchParams.get("type");
  const severityParam = searchParams.get("severity");
  const resolved = searchParams.get("resolved");

  const validTypes = Object.values(AlertType);
  if (typeParam && !validTypes.includes(typeParam as AlertType)) {
    return Response.json(
      { error: `Invalid type. Must be one of: ${validTypes.join(", ")}` },
      { status: 400 }
    );
  }

  const validSeverities = Object.values(AlertSeverity);
  if (severityParam && !validSeverities.includes(severityParam as AlertSeverity)) {
    return Response.json(
      { error: `Invalid severity. Must be one of: ${validSeverities.join(", ")}` },
      { status: 400 }
    );
  }

  const alertType = typeParam as AlertType | null;
  const severity = severityParam as AlertSeverity | null;

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
