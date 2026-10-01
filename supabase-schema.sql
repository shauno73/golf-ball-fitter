-- Golf Ball Fitter — Supabase schema
-- Run this once in your Supabase project's SQL editor (Database > SQL Editor > New query).

create extension if not exists pgcrypto;

-- One row per completed questionnaire. Full answers + the recommendation
-- result are stored as JSONB so the schema doesn't need a migration every
-- time a question changes; a few columns are pulled out for easy filtering.
create table if not exists fitting_submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  speed_band text,
  best_overall_ball text,
  best_value_ball text,
  premium_alternative_ball text,
  answers jsonb not null,
  results jsonb not null
);

-- Lightweight feedback tied to a submission: "did this feel right?"
create table if not exists tester_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  submission_id uuid references fitting_submissions(id) on delete set null,
  rating text not null check (rating in ('yes', 'sort_of', 'no')),
  comment text
);

-- Row Level Security: this is a public, unauthenticated MVP for testing
-- with mates. The anon key IS meant to be visible in the browser's JS —
-- that's normal for Supabase's client-side model. What actually protects
-- the data is these policies: anonymous visitors can INSERT (submit a
-- fitting or feedback) but cannot SELECT, UPDATE, or DELETE anything,
-- including other people's rows. Only you, via the Supabase dashboard or
-- an authenticated service role key, can read the results.

alter table fitting_submissions enable row level security;
alter table tester_feedback enable row level security;

create policy "Anyone can submit a fitting"
  on fitting_submissions for insert
  to anon
  with check (true);

create policy "Anyone can submit feedback"
  on tester_feedback for insert
  to anon
  with check (true);

-- No select/update/delete policies are created for the anon role, which
-- means those actions are denied by default under RLS.

-- A policy alone isn't enough — Postgres also needs the base GRANT before
-- RLS is even consulted. If you leave Supabase's "Automatically expose new
-- tables" option OFF when creating the project (its own recommended,
-- more secure setting), nothing below is automatic — these two lines are
-- what actually give the anon role permission to write at all.
grant usage on schema public to anon;
grant insert on fitting_submissions, tester_feedback to anon;
