export { auth as middleware } from "@/lib/auth";

export const config = {
  matcher: [
    /*
     * Protect all routes except:
     * - /api/auth/** (next-auth sign-in, callback, session endpoints)
     * - /_next/static (static assets)
     * - /_next/image (image optimisation)
     * - /favicon.ico
     */
    "/((?!api/auth|api/health|_next/static|_next/image|favicon\\.ico).*)",
  ],
};
