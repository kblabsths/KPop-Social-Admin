import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdmin, paginationParams } from "@/lib/admin";
import type { NextRequest } from "next/server";

// Kept in sync with src/app/database/page.tsx — tables that actually exist
// in the shared Supabase project.
const ALLOWED_MODELS = [
  "user",
  "group",
  "idol",
  "venue",
  "event",
  "scrapedEvent",
  "post",
  "scraperRun",
] as const;

type AllowedModel = (typeof ALLOWED_MODELS)[number];

const MODEL_TO_TABLE: Record<AllowedModel, string> = {
  user: "profiles",
  group: "groups",
  idol: "idols",
  venue: "venues",
  event: "events",
  scrapedEvent: "scraped_events",
  post: "posts",
  scraperRun: "scraper_runs",
};

// scraper_runs has no created_at column
const MODEL_ORDER_COLUMN: Record<AllowedModel, string> = {
  user: "created_at",
  group: "created_at",
  idol: "created_at",
  venue: "created_at",
  event: "created_at",
  scrapedEvent: "created_at",
  post: "created_at",
  scraperRun: "started_at",
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
    .order(MODEL_ORDER_COLUMN[model as AllowedModel], { ascending: false })
    .range(skip, skip + pageSize - 1);

  if (queryError) return Response.json({ error: queryError.message }, { status: 500 });

  return Response.json({ data: data ?? [], total: total ?? 0, page, pageSize });
}
