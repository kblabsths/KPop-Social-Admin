import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";
import type { NextRequest } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { id } = await params;

  const run = await prisma.scraperRun.findUnique({
    where: { id },
    include: {
      logs: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!run) {
    return Response.json({ error: "Scraper run not found" }, { status: 404 });
  }

  return Response.json(run);
}
