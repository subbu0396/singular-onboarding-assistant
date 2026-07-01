-- Phase 7: doc lifecycle.
--
-- Stores every completed generation so the SE can revisit past clients
-- without re-running the pipeline and so the runbook/faq/checklist can
-- be shared via a public read-only URL. All rows are globally visible
-- on the homepage list — access-control is intentionally minimal to
-- match the rest of the app's demo shape.

create table if not exists generations (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  target_mmp text,
  form_snapshot jsonb not null,
  documents jsonb not null,               -- {runbook, faq, checklist}
  share_token text unique,                -- 32-char random hex
  share_expires_at timestamptz,           -- created_at + 24h by default
  created_at timestamptz not null default now()
);

create index if not exists generations_created_at_idx
  on generations (created_at desc);

create index if not exists generations_share_token_idx
  on generations (share_token);
