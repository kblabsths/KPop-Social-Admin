import { getSupabaseAdmin } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: concert } = await supabase
    .from("concerts")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (!concert) {
    return Response.json({ error: "Concert not found" }, { status: 404 });
  }

  const body = await request.json();
  const { status } = body;

  if (status !== "interested" && status !== "going") {
    return Response.json(
      { error: 'Status must be "interested" or "going"' },
      { status: 400 }
    );
  }

  // Check for existing RSVP
  const { data: existing } = await supabase
    .from("user_concerts")
    .select("id")
    .eq("user_id", session.user.id)
    .eq("concert_id", id)
    .maybeSingle();

  let rsvp;
  if (existing) {
    const { data, error } = await supabase
      .from("user_concerts")
      .update({ status })
      .eq("user_id", session.user.id)
      .eq("concert_id", id)
      .select()
      .single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    rsvp = data;
  } else {
    const { data, error } = await supabase
      .from("user_concerts")
      .insert({ id: crypto.randomUUID(), user_id: session.user.id, concert_id: id, status })
      .select()
      .single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    rsvp = data;
  }

  return Response.json(rsvp);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: existing } = await supabase
    .from("user_concerts")
    .select("id")
    .eq("user_id", session.user.id)
    .eq("concert_id", id)
    .maybeSingle();

  if (!existing) {
    return Response.json({ error: "RSVP not found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("user_concerts")
    .delete()
    .eq("user_id", session.user.id)
    .eq("concert_id", id);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ removed: true });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const { id } = await params;

  try {
    const { data: concert } = await supabase
      .from("concerts")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (!concert) {
      return Response.json({ error: "Concert not found" }, { status: 404 });
    }

    const [interestedResult, goingResult] = await Promise.all([
      supabase
        .from("user_concerts")
        .select("*", { count: "exact", head: true })
        .eq("concert_id", id)
        .eq("status", "interested"),
      supabase
        .from("user_concerts")
        .select("*", { count: "exact", head: true })
        .eq("concert_id", id)
        .eq("status", "going"),
    ]);

    const interested = interestedResult.count ?? 0;
    const going = goingResult.count ?? 0;

    let userStatus: string | null = null;
    const session = await auth();
    if (session?.user?.id) {
      const { data: userRsvp } = await supabase
        .from("user_concerts")
        .select("status")
        .eq("user_id", session.user.id)
        .eq("concert_id", id)
        .maybeSingle();
      userStatus = userRsvp?.status ?? null;
    }

    return Response.json({ interested, going, userStatus });
  } catch (error) {
    console.error("Failed to fetch RSVP data:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
