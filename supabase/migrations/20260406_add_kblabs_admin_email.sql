-- Grant admin site access to kb.labs.ths@gmail.com
-- Requested via KBL-130

INSERT INTO public.admin_allowed_emails (email)
VALUES ('kb.labs.ths@gmail.com')
ON CONFLICT (email) DO NOTHING;
