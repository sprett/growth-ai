-- Team invites: lets a teammate join an org via a shareable link and skip onboarding.
--
-- Run this once in the Supabase SQL editor (or via `supabase db execute`).
-- It is additive: existing RLS policies on connections/experiments are left in
-- place, and org-member access is granted through new policies alongside them.

create extension if not exists pgcrypto;

-- An org's identity is just a uuid. For the person who onboards first it
-- happens to equal their own auth.uid(), which means existing connections /
-- experiments rows (already keyed by org_id = that user's id) need no backfill.
create table if not exists memberships (
  user_id uuid primary key references auth.users (id) on delete cascade,
  org_id uuid not null,
  role text not null default 'owner',
  github_login text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create index if not exists memberships_org_id_idx on memberships (org_id);

create table if not exists invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  invited_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id)
);

create index if not exists invites_org_id_idx on invites (org_id);

-- Security-definer helper so membership policies can check "same org as me"
-- without the naive self-join pattern that trips Postgres's recursive-RLS guard.
create or replace function my_org_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select org_id from memberships where user_id = auth.uid()
$$;

grant execute on function my_org_id() to authenticated;

alter table memberships enable row level security;
alter table invites enable row level security;

drop policy if exists "members can view their org" on memberships;
-- Own row must be visible without my_org_id(): INSERT … RETURNING applies
-- SELECT policies in the same statement, and STABLE my_org_id() cannot see
-- the row being inserted (bootstrap would fail RLS).
create policy "members can view their org" on memberships
  for select using (user_id = auth.uid() or org_id = my_org_id());

drop policy if exists "users can bootstrap their own membership" on memberships;
create policy "users can bootstrap their own membership" on memberships
  for insert with check (user_id = auth.uid());

drop policy if exists "org owners can create invites" on invites;
create policy "org owners can create invites" on invites
  for insert with check (invited_by = auth.uid() and org_id = my_org_id());

drop policy if exists "members can view their org invites" on invites;
create policy "members can view their org invites" on invites
  for select using (org_id = my_org_id());

-- Atomic accept: validates the invite is unused, rejects users who already
-- belong to an org, and joins them — all in one statement so two people
-- racing the same single-use link can't both get in.
create or replace function accept_invite(invite_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  if exists (select 1 from memberships where user_id = auth.uid()) then
    raise exception 'already_member';
  end if;

  update invites
  set accepted_at = now(), accepted_by = auth.uid()
  where id = invite_id and accepted_at is null
  returning org_id into v_org_id;

  if v_org_id is null then
    raise exception 'invalid_invite';
  end if;

  insert into memberships (user_id, org_id, role, github_login, avatar_url)
  values (
    auth.uid(),
    v_org_id,
    'member',
    (select raw_user_meta_data ->> 'user_name' from auth.users where id = auth.uid()),
    (select raw_user_meta_data ->> 'avatar_url' from auth.users where id = auth.uid())
  );

  return v_org_id;
end;
$$;

grant execute on function accept_invite(uuid) to authenticated;

-- Additive: teammates (org_id via membership, not just their own auth.uid())
-- can read/write the org's connection + experiments rows. Permissive
-- policies for the same command OR together, so any existing
-- "org_id = auth.uid()" policy on these tables keeps working unchanged.
drop policy if exists "org members can select connections" on connections;
create policy "org members can select connections" on connections
  for select using (org_id = my_org_id());

drop policy if exists "org members can upsert connections" on connections;
create policy "org members can upsert connections" on connections
  for insert with check (org_id = my_org_id());

drop policy if exists "org members can update connections" on connections;
create policy "org members can update connections" on connections
  for update using (org_id = my_org_id()) with check (org_id = my_org_id());

drop policy if exists "org members can select experiments" on experiments;
create policy "org members can select experiments" on experiments
  for select using (org_id = my_org_id());

drop policy if exists "org members can insert experiments" on experiments;
create policy "org members can insert experiments" on experiments
  for insert with check (org_id = my_org_id());
