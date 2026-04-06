-- Web app schema migration
-- Adds tables for the Next.js web/admin app that are not yet in Supabase.
-- The web app uses NextAuth JWT sessions (not Supabase Auth), so web_users uses
-- a text primary key (NextAuth CUID) rather than a UUID FK to auth.users.
--
-- Tables that already exist in Supabase (profiles, events, notifications) are
-- extended with ALTER TABLE where new columns are needed.

-- ============================================================
-- WEB USERS
-- Mirrors the Prisma User model. Uses text PK (NextAuth CUID).
-- ============================================================
create table if not exists public.web_users (
  id              text primary key,
  name            text,
  email           text unique,
  email_verified  timestamptz,
  image           text,
  bio             text,
  role            text not null default 'USER' check (role in ('USER', 'ADMIN')),
  favorite_artists text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_web_users_email on public.web_users(email);

-- ============================================================
-- ARTISTS
-- ============================================================
create table if not exists public.artists (
  id           text primary key,
  name         text not null,
  korean_name  text,
  slug         text unique not null,
  type         text not null default 'group' check (type in ('group', 'solo')),
  company      text,
  description  text,
  image        text,
  debut_date   timestamptz,
  country      text not null default 'KR',
  genres       text[] not null default '{}',
  social_links jsonb,
  external_ids jsonb,
  member_count integer,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_artists_slug on public.artists(slug);
create index if not exists idx_artists_name on public.artists(name);

-- ============================================================
-- VENUES
-- ============================================================
create table if not exists public.venues (
  id           text primary key,
  name         text not null,
  slug         text unique not null,
  city         text not null,
  state        text,
  country      text not null,
  latitude     double precision,
  longitude    double precision,
  capacity     integer,
  type         text check (type in ('arena', 'stadium', 'theater', 'convention_center')),
  address      text,
  image_url    text,
  timezone     text,
  external_ids jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_venues_slug on public.venues(slug);

-- ============================================================
-- CONCERTS
-- Full concert model (richer than the mobile app's `events` table).
-- ============================================================
create table if not exists public.concerts (
  id             text primary key,
  title          text not null,
  slug           text unique not null,
  tour_name      text,
  date           timestamptz not null,
  end_date       timestamptz,
  doors_open     timestamptz,
  status         text not null default 'scheduled'
                   check (status in ('scheduled','on_sale','sold_out','cancelled','postponed','completed')),
  ticket_url     text,
  price_range    jsonb,
  image_url      text,
  description    text,
  event_type     text not null default 'concert'
                   check (event_type in ('concert','fan_meeting','festival','showcase')),
  external_ids   jsonb,
  venue_id       text not null references public.venues(id),
  source         text,
  source_url     text,
  last_synced_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_concerts_date    on public.concerts(date);
create index if not exists idx_concerts_status  on public.concerts(status);
create index if not exists idx_concerts_venue   on public.concerts(venue_id);

-- Many-to-many: concerts ↔ artists
create table if not exists public.concert_artists (
  concert_id text not null references public.concerts(id) on delete cascade,
  artist_id  text not null references public.artists(id)  on delete cascade,
  primary key (concert_id, artist_id)
);

-- ============================================================
-- USER CONCERTS (RSVPs)
-- ============================================================
create table if not exists public.user_concerts (
  id         text primary key,
  user_id    text not null references public.web_users(id) on delete cascade,
  concert_id text not null references public.concerts(id)  on delete cascade,
  status     text not null check (status in ('interested', 'going')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, concert_id)
);

create index if not exists idx_user_concerts_concert on public.user_concerts(concert_id);
create index if not exists idx_user_concerts_status  on public.user_concerts(status);

-- ============================================================
-- USER ARTIST FOLLOWS
-- ============================================================
create table if not exists public.user_artist_follows (
  id         text primary key,
  user_id    text not null references public.web_users(id) on delete cascade,
  artist_id  text not null references public.artists(id)   on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, artist_id)
);

-- Many-to-many: users ↔ favorite artists
create table if not exists public.user_favorite_artists (
  user_id   text not null references public.web_users(id) on delete cascade,
  artist_id text not null references public.artists(id)   on delete cascade,
  primary key (user_id, artist_id)
);

-- ============================================================
-- GROUPS (KPop bands — canonical schema shared with mobile app)
-- Source of truth: mobile migration 20260406000002_groups_idols_schema.sql
-- Defined here with IF NOT EXISTS so admin-only deploys bootstrap correctly.
-- The stale fan-groups definition has been removed; groups = KPop bands.
-- ============================================================
create table if not exists public.groups (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  short_name    text,
  korean_name   text,
  image_url     text,
  bio           text,
  company       text,
  debut_date    date,
  status        text default 'active'
                check (status in ('active', 'disbanded', 'hiatus')),
  type          text
                check (type in ('boy_group', 'girl_group', 'co_ed')),
  member_count  integer,
  fanclub_name  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_groups_name   on public.groups (name);
create index if not exists idx_groups_status on public.groups (status);
create index if not exists idx_groups_type   on public.groups (type);

-- ============================================================
-- IDOLS (individual KPop idol records — canonical schema shared with mobile app)
-- Source of truth: mobile migration 20260406000002_groups_idols_schema.sql
-- ============================================================
create table if not exists public.idols (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid references public.groups(id),
  stage_name   text not null,
  real_name    text,
  korean_name  text,
  image_url    text,
  position     text,
  birth_date   date,
  nationality  text,
  gender       text
               check (gender in ('M', 'F')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_idols_group_id   on public.idols (group_id);
create index if not exists idx_idols_stage_name on public.idols (stage_name);

-- ============================================================
-- POSTS & LIKES
-- ============================================================
create table if not exists public.posts (
  id         text primary key,
  content    text not null,
  image_url  text,
  link_url   text,
  author_id  text not null references public.web_users(id) on delete cascade,
  group_id   uuid not null references public.groups(id)    on delete cascade,
  parent_id  text references public.posts(id)              on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_posts_group    on public.posts(group_id);
create index if not exists idx_posts_author   on public.posts(author_id);
create index if not exists idx_posts_parent   on public.posts(parent_id);

create table if not exists public.post_likes (
  id         text primary key,
  user_id    text not null references public.web_users(id) on delete cascade,
  post_id    text not null references public.posts(id)     on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, post_id)
);

-- ============================================================
-- WEB NOTIFICATIONS
-- Separate from the mobile app's `notifications` table.
-- ============================================================
create table if not exists public.web_notifications (
  id         text primary key,
  user_id    text not null references public.web_users(id) on delete cascade,
  type       text not null check (type in ('new_concert', 'group_post', 'concert_reminder', 'new_follower')),
  title      text not null,
  body       text not null,
  link       text not null,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_web_notifications_user on public.web_notifications(user_id, read, created_at desc);

-- ============================================================
-- SCRAPER TRACKING
-- ============================================================
create table if not exists public.scraper_runs (
  id              text primary key,
  scraper_name    text not null,
  status          text not null default 'RUNNING'
                    check (status in ('RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL')),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  records_created integer not null default 0,
  records_updated integer not null default 0,
  records_failed  integer not null default 0,
  error_message   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_scraper_runs_name   on public.scraper_runs(scraper_name);
create index if not exists idx_scraper_runs_status on public.scraper_runs(status);
create index if not exists idx_scraper_runs_started on public.scraper_runs(started_at);

create table if not exists public.scraper_logs (
  id             text primary key,
  scraper_run_id text not null references public.scraper_runs(id) on delete cascade,
  level          text not null check (level in ('INFO', 'WARN', 'ERROR')),
  message        text not null,
  metadata       jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists idx_scraper_logs_run   on public.scraper_logs(scraper_run_id);
create index if not exists idx_scraper_logs_level on public.scraper_logs(level);

create table if not exists public.data_quality_alerts (
  id          text primary key,
  alert_type  text not null check (alert_type in ('MISSING_FIELD', 'DUPLICATE', 'STALE_DATA', 'INCONSISTENCY')),
  severity    text not null check (severity in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  entity_type text not null,
  entity_id   text not null,
  message     text not null,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_dqa_type        on public.data_quality_alerts(alert_type);
create index if not exists idx_dqa_severity    on public.data_quality_alerts(severity);
create index if not exists idx_dqa_entity      on public.data_quality_alerts(entity_type, entity_id);
create index if not exists idx_dqa_resolved_at on public.data_quality_alerts(resolved_at);
