import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const concert = await prisma.concert.findUnique({ where: { id } });
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

  const rsvp = await prisma.userConcert.upsert({
    where: {
      userId_concertId: { userId: session.user.id, concertId: id },
    },
    create: {
      userId: session.user.id,
      concertId: id,
      status,
    },
    update: {
      status,
    },
  });

  return Response.json(rsvp);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await prisma.userConcert.findUnique({
    where: {
      userId_concertId: { userId: session.user.id, concertId: id },
    },
  });

  if (!existing) {
    return Response.json({ error: "RSVP not found" }, { status: 404 });
  }

  await prisma.userConcert.delete({
    where: {
      userId_concertId: { userId: session.user.id, concertId: id },
    },
  });

  return Response.json({ removed: true });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const concert = await prisma.concert.findUnique({ where: { id } });
    if (!concert) {
      return Response.json({ error: "Concert not found" }, { status: 404 });
    }

    const [interested, going] = await Promise.all([
      prisma.userConcert.count({ where: { concertId: id, status: "interested" } }),
      prisma.userConcert.count({ where: { concertId: id, status: "going" } }),
    ]);

    let userStatus: string | null = null;
    const session = await auth();
    if (session?.user?.id) {
      const userRsvp = await prisma.userConcert.findUnique({
        where: {
          userId_concertId: { userId: session.user.id, concertId: id },
        },
      });
      userStatus = userRsvp?.status ?? null;
    }

    return Response.json({ interested, going, userStatus });
  } catch (error) {
    console.error("Failed to fetch RSVP data:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
