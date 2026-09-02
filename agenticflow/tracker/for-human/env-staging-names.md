Add STAGING_SUPABASE_URL and STAGING_SUPABASE_SERVICE_ROLE_KEY to .env (the service_role key from Supabase → Project Settings → API, not the anon key). .env today carries SUPABASE_URL + SUPABASE_ANON_KEY only, and the anon role sees none of the ecosystem tables.
Recommend: keep the old SUPABASE_* lines untouched; add the two STAGING_* names beside them.
Unblocks: every live staging read and parity test from M1's first build tick (acceptance tests 2–5, 9–11).
