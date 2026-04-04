import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdmin, paginationParams } from "@/lib/admin";
import { NextRequest } from "next/server";

const VALID_TYPES = ["STALE_DATA", "MISSING_DATA", "DUPLICATE_DATA", "VALIDATION_ERROR"] as const;
const VALID_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export async function GET(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  const { error } = await requireAdmin();
  if (error) return error;

  const { searchParams } = request.nextUrl;
  const { page, pageSize, skip } = paginationParams(searchParams);
  const typeParam = searchParams.get("type");
  const severityParam = searchParams.get("severity");
  const resolved = searchParams.get("resolved");

  if (typeParam && !VALID_TYPES.includes(typeParam as typeof VALID_TYPES[number])) {
    return Response.json(
      { error: `Invalid type. Must be one of: ${VALID_TYPES.join(", ")}` },
      { status: 400 }
    );
  }

  if (severityParam && !VALID_SEVERITIES.includes(severityParam as typeof VALID_SEVERITIES[number])) {
    return Response.json(
      { error: `Invalid severity. Must be one of: ${VALID_SEVERITIES.join(", ")}` },
      { status: 400 }
    );
  }

  let queryBuilder = supabase
    .from("data_quality_alerts")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(skip, skip + pageSize - 1);

  if (typeParam) queryBuilder = queryBuilder.eq("alert_type", typeParam);
  if (severityParam) queryBuilder = queryBuilder.eq("severity", severityParam);
  if (resolved === "true") queryBuilder = queryBuilder.not("resolved_at", "is", null);
  if (resolved === "false") queryBuilder = queryBuilder.is("resolved_at", null);

  const { data, count: total, error: queryError } = await queryBuilder;
  if (queryError) return Response.json({ error: queryError.message }, { status: 500 });

  return Response.json({ data: data ?? [], total: total ?? 0, page, pageSize });
}
