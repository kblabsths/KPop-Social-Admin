# kspace Admin

Internal admin dashboard for the kspace app: catalog management (groups, idols, events) and scraper
operations (raw scraped events, scraper runs, reconciliation review) on top of a shared Supabase project.

Built with Next.js (App Router), Tailwind CSS, and next-auth v5. All data access goes through the
Supabase **service-role** client (`src/lib/supabase.ts`) in server components and API routes — there is
no client-side Supabase usage.

## Authentication

Sign-in is Google OAuth via next-auth, gated by an allowlist: an email must exist in the
`admin_allowed_emails` table in Supabase (matched case-insensitively) or sign-in is rejected.
There is no self-serve signup — add rows to that table to grant access.

## Environment variables

Copy `.env.example` to `.env.local` and fill in:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL (server-side only, no `NEXT_PUBLIC_` prefix) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key — bypasses RLS, never expose to the client |
| `AUTH_SECRET` | next-auth secret (`npx auth secret`) |
| `AUTH_URL` | Public app URL (`http://localhost:3000` in dev, Railway domain in prod) |
| `AUTH_GOOGLE_ID` | Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | Google OAuth client secret |

## Development

```bash
npm install
npm run dev   # http://localhost:3000
```

`npm run build` / `npm run start` for a production build, `npm run lint` for ESLint.

## Deployment

Deployed on Railway. Set the env vars above in the Railway service (point `AUTH_URL` at the public
Railway domain, e.g. `https://your-app.up.railway.app`) and add that domain as an authorized redirect
URI on the Google OAuth client (`<AUTH_URL>/api/auth/callback/google`).
