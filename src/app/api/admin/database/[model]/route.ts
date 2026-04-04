import { getSupabaseAdmin } from "@/lib/supabase";
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

const MODEL_TO_TABLE: Record<AllowedModel, string> = {
  user: "web_users",
  artist: "artists",
  venue: "venues",
  concert: "concerts",
  group: "groups",
  post: "posts",
  scraperRun: "scraper_runs",
  scraperLog: "scraper_logs",
  dataQualityAlert: "data_quality_alerts",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ model: string }> }
) {
  const supabase = getSupabaseAdmin();
  const { error } = await requireAdmin();
  if (error) return error;

  const { model } = await params;

  if (!ALLOWED_MODELS.includes(model as AllowedModel)) {
    return Response.json(
      { error: `Invalid model. Allowed: ${ALLOWED_MODELS.join(", ")}` },
      { status: 400 }
    );
  }

  const tableName = MODEL_TO_TABLE[model as AllowedModel];

  const { searchParams } = request.nextUrl;
  const { page, pageSize, skip } = paginationParams(searchParams);

  const { data, count: total, error: queryError } = await supabase
    .from(tableName)
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(skip, skip + pageSize - 1);

  if (queryError) return Response.json({ error: queryError.message }, { status: 500 });

  return Response.json({ data: data ?? [], total: total ?? 0, page, pageSize });
}
