import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdmin, paginationParams } from "@/lib/admin";
import { NextRequest } from "next/server";

const VALID_STATUSES = ["running", "completed", "failed"] as const;

export async function GET(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  const { error } = await requireAdmin();
  if (error) return error;

  const { searchParams } = request.nextUrl;
  const { page, pageSize, skip } = paginationParams(searchParams);
  const statusParam = searchParams.get("status");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (statusParam && !VALID_STATUSES.includes(statusParam as typeof VALID_STATUSES[number])) {
    return Response.json(
      { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
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

  let queryBuilder = supabase
    .from("scraper_runs")
    .select("*", { count: "exact" })
    .order("started_at", { ascending: false })
    .range(skip, skip + pageSize - 1);

  if (statusParam) queryBuilder = queryBuilder.eq("status", statusParam);
  if (from) queryBuilder = queryBuilder.gte("started_at", new Date(from).toISOString());
  if (to) queryBuilder = queryBuilder.lte("started_at", new Date(to).toISOString());

  const { data, count: total, error: queryError } = await queryBuilder;
  if (queryError) return Response.json({ error: queryError.message }, { status: 500 });

  return Response.json({ data: data ?? [], total: total ?? 0, page, pageSize });
}
