import { getSupabaseAdmin } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const { id: userId } = await params;

  // Verify user exists
  const { data: user } = await supabase
    .from("web_users")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  // Check if this is the authenticated user's own profile
  const session = await auth();
  const isOwnProfile = session?.user?.id === userId;

  const now = new Date().toISOString();

  // Run all queries in parallel
  const [
    concertsResult,
    artistsResult,
    groupsResult,
    postsResult,
    concertCountResult,
    artistFollowCountResult,
    groupCountResult,
    postCountResult,
  ] = await Promise.all([
    // Upcoming concerts with RSVP
    supabase
      .from("user_concerts")
      .select(`
        id, status, created_at,
        concert:concerts(
          *,
          artists:concert_artists(artist:artists(id, name, slug, image)),
          venue:venues(id, name, city, country)
        )
      `)
      .eq("user_id", userId)
      .gte("concert.date", now)
      .order("concert(date)", { ascending: true }),

    // Followed artists
    supabase
      .from("user_artist_follows")
      .select("id, created_at, artist:artists(id, name, slug, image, type, company)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),

    // Group memberships
    supabase
      .from("group_members")
      .select("id, role, joined_at, group:groups(id, name, image, is_official, artist_id)")
      .eq("user_id", userId)
      .order("joined_at", { ascending: false }),

    // Recent top-level posts (limit 10)
    supabase
      .from("posts")
      .select(`
        id, content, image_url, link_url, created_at,
        group:groups(id, name),
        likes_count:post_likes(count),
        replies_count:posts!parent_id(count)
      `)
      .eq("author_id", userId)
      .is("parent_id", null)
      .order("created_at", { ascending: false })
      .limit(10),

    // Stats counts
    supabase.from("user_concerts").select("*", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("user_artist_follows").select("*", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("group_members").select("*", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("posts").select("*", { count: "exact", head: true }).eq("author_id", userId).is("parent_id", null),
  ]);

  const concerts = (concertsResult.data ?? []).map((uc) => {
    const concert = uc.concert as unknown as Record<string, unknown> | null;
    if (!concert) return null;
    return {
      id: uc.id,
      status: uc.status,
      concert: {
        ...concert,
        artists: ((concert.artists as { artist: unknown }[]) ?? []).map((a) => a.artist),
      },
      createdAt: uc.created_at,
    };
  }).filter(Boolean);

  const artists = (artistsResult.data ?? []).map((ua) => ({
    id: ua.id,
    artist: ua.artist,
    createdAt: ua.created_at,
  }));

  const groups = (groupsResult.data ?? []).map((gm) => ({
    id: gm.id,
    role: gm.role,
    group: gm.group,
    joinedAt: gm.joined_at,
  }));

  const posts = (postsResult.data ?? []).map((p) => ({
    id: p.id,
    content: p.content,
    imageUrl: p.image_url,
    linkUrl: p.link_url,
    group: p.group,
    likeCount: (p.likes_count as { count: number }[])?.[0]?.count ?? 0,
    replyCount: (p.replies_count as { count: number }[])?.[0]?.count ?? 0,
    createdAt: p.created_at,
  }));

  return Response.json({
    concerts,
    artists,
    groups,
    posts,
    stats: {
      concertCount: concertCountResult.count ?? 0,
      artistFollowCount: artistFollowCountResult.count ?? 0,
      groupCount: groupCountResult.count ?? 0,
      postCount: postCountResult.count ?? 0,
    },
    isOwnProfile,
  });
}
