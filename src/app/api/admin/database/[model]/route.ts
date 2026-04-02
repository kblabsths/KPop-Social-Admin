import { prisma } from "@/lib/prisma";
import { requireAdmin, paginationParams } from "@/lib/admin";
import type { NextRequest } from "next/server";

const ALLOWED_MODELS = [
  "user",
  "artist",
  "venue",
  "concert",
  "group",
  "post",
  "scraperRun",
  "scraperLog",
  "dataQualityAlert",
] as const;

type AllowedModel = (typeof ALLOWED_MODELS)[number];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ model: string }> }
) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { model } = await params;

  if (!ALLOWED_MODELS.includes(model as AllowedModel)) {
    return Response.json(
      { error: `Invalid model. Allowed: ${ALLOWED_MODELS.join(", ")}` },
      { status: 400 }
    );
  }

  const { searchParams } = request.nextUrl;
  const { page, pageSize, skip } = paginationParams(searchParams);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delegate = (prisma as any)[model];

  const [data, total] = await Promise.all([
    delegate.findMany({
      skip,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    delegate.count(),
  ]);

  return Response.json({ data, total, page, pageSize });
}
