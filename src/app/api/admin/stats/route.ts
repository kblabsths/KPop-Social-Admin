import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const [users, artists, venues, concerts, scraperRuns, activeAlerts] =
    await Promise.all([
      prisma.user.count(),
      prisma.artist.count(),
      prisma.venue.count(),
      prisma.concert.count(),
      prisma.scraperRun.count(),
      prisma.dataQualityAlert.count({ where: { resolvedAt: null } }),
    ]);

  return Response.json({
    users,
    artists,
    venues,
    concerts,
    scraperRuns,
    activeAlerts,
  });
}
