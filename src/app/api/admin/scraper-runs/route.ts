import { prisma } from "@/lib/prisma";
import { requireAdmin, paginationParams } from "@/lib/admin";
import { NextRequest } from "next/server";
import { ScraperRunStatus } from "@/generated/prisma/client";

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { searchParams } = request.nextUrl;
  const { page, pageSize, skip } = paginationParams(searchParams);
  const status = searchParams.get("status") as ScraperRunStatus | null;
  const from = searchParams.get("from");
  const to = searchParams.get("to");

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
