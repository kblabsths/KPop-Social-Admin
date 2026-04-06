-- Admin allowlist migration
-- Creates admin_allowed_emails table to restrict sign-in to approved addresses only.
-- Board directed use of a table (not env var) to support multiple emails
-- and future security-level variance.

CREATE TABLE IF NOT EXISTS public.admin_allowed_emails (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_allowed_emails ENABLE ROW LEVEL SECURITY;

-- Seed initial admin email
INSERT INTO public.admin_allowed_emails (email)
VALUES ('admin@kpopsocialspace.com')
ON CONFLICT (email) DO NOTHING;
