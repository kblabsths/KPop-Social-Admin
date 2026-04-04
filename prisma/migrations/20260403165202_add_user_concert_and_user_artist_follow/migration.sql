-- CreateTable
CREATE TABLE "UserConcert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "concertId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserConcert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserArtistFollow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserArtistFollow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserConcert_concertId_idx" ON "UserConcert"("concertId");

-- CreateIndex
CREATE INDEX "UserConcert_status_idx" ON "UserConcert"("status");

-- CreateIndex
CREATE UNIQUE INDEX "UserConcert_userId_concertId_key" ON "UserConcert"("userId", "concertId");

-- CreateIndex
CREATE UNIQUE INDEX "UserArtistFollow_userId_artistId_key" ON "UserArtistFollow"("userId", "artistId");

-- AddForeignKey
ALTER TABLE "UserConcert" ADD CONSTRAINT "UserConcert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserConcert" ADD CONSTRAINT "UserConcert_concertId_fkey" FOREIGN KEY ("concertId") REFERENCES "Concert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserArtistFollow" ADD CONSTRAINT "UserArtistFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserArtistFollow" ADD CONSTRAINT "UserArtistFollow_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
