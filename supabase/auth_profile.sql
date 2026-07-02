-- Phase 10: SE authentication + multi-tenancy.
--
-- Adds a profiles table keyed off Supabase Auth's auth.users, an owner_id
-- foreign key on generations, and RLS so an SE only sees their own rows.
--
-- Run this after enabling the Google provider in Supabase Auth
-- (Dashboard → Authentication → Providers → Google).

-- 1. Profile row per authenticated SE. Populated by the auth callback
-- after the email's domain has been validated against MMP_DOMAIN_ALLOWLIST.
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  mmp_platform text not null,             -- e.g. "Singular", "AppsFlyer"
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists profiles_email_idx on profiles (email);

alter table profiles enable row level security;

-- An SE can only read/update their own profile row.
drop policy if exists "profiles_self_read" on profiles;
create policy "profiles_self_read"
  on profiles for select
  using (id = auth.uid());

drop policy if exists "profiles_self_update" on profiles;
create policy "profiles_self_update"
  on profiles for update
  using (id = auth.uid());

-- 2. Add owner_id to generations. Nullable so existing rows survive the
-- migration; those rows become invisible via the RLS policy below (legacy).
alter table generations
  add column if not exists owner_id uuid references profiles (id) on delete set null;

create index if not exists generations_owner_id_idx
  on generations (owner_id);

alter table generations enable row level security;

-- Signed-in SEs see only rows they own. Server-side share-token lookups
-- run with the service role and bypass RLS, so /share/[token] keeps working
-- for anonymous recipients.
drop policy if exists "generations_owner_read" on generations;
create policy "generations_owner_read"
  on generations for select
  using (owner_id = auth.uid());

drop policy if exists "generations_owner_insert" on generations;
create policy "generations_owner_insert"
  on generations for insert
  with check (owner_id = auth.uid());

drop policy if exists "generations_owner_update" on generations;
create policy "generations_owner_update"
  on generations for update
  using (owner_id = auth.uid());

drop policy if exists "generations_owner_delete" on generations;
create policy "generations_owner_delete"
  on generations for delete
  using (owner_id = auth.uid());
