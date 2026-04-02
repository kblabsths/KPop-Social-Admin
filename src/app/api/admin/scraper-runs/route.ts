import { prisma } from "@/lib/prisma";
import { requireAdmin, paginationParams } from "@/lib/admin";
import { NextRequest } from "next/server";
import { ScraperRunStatus } from "@/generated/prisma/client";

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { searchParams } = request.nextUrl;
  const { page, pageSize, skip } = paginationParams(searchParams);
  const statusParam = searchParams.get("status");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const validStatuses = Object.values(ScraperRunStatus);
  if (statusParam && !validStatuses.includes(statusParam as ScraperRunStatus)) {
    return Response.json(
      { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
      { status: 400 }
    );
  }

  if (from && isNaN(new Date(from).getTime())) {
    return Response.json(
      { error: "Invalid 'from' date format" },
      { status: 400 }
    );
  }

  if (to && isNaN(new Date(to).getTime())) {
    return Response.json(
      { error: "Invalid 'to' date format" },
      { status: 400 }
    );
  }

  const status = statusParam as ScraperRunStatus | null;

  const where = {
    ...(status ? { status } : {}),
    ...(from || to
      ? {
          startedAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {}),
  };

  const [data, total] = await Promise.all([
    prisma.scraperRun.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.scraperRun.count({ where }),
  ]);

  return Response.json({ data, total, page, pageSize });
}
