-- xAutoML schema for Supabase free tier
-- Run in Supabase → SQL Editor

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null,
  data_key_b64 text not null,
  storage_used bigint not null default 0 check (storage_used >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  size bigint not null check (size >= 0),
  mime_type text not null default '',
  ext text not null,
  kind text not null check (kind in ('numerical', 'document', 'image', 'audio')),
  storage_path text not null,
  iv text not null,
  fingerprint text not null,
  added_at timestamptz not null default now(),
  unique (user_id, fingerprint)
);

create index if not exists documents_user_id_idx on public.documents (user_id);

create table if not exists public.runs (
  id text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null check (status in ('running', 'complete', 'failed')),
  stage text not null check (stage in ('detect', 'clean', 'automl', 'explain')),
  file_count integer not null default 0,
  summary text not null default '',
  result jsonb not null default '{}'::jsonb,
  resources jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists runs_user_id_created_idx on public.runs (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.runs enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

create policy "documents_select_own" on public.documents
  for select using (auth.uid() = user_id);
create policy "documents_insert_own" on public.documents
  for insert with check (auth.uid() = user_id);
create policy "documents_update_own" on public.documents
  for update using (auth.uid() = user_id);
create policy "documents_delete_own" on public.documents
  for delete using (auth.uid() = user_id);

create policy "runs_select_own" on public.runs
  for select using (auth.uid() = user_id);
create policy "runs_insert_own" on public.runs
  for insert with check (auth.uid() = user_id);
create policy "runs_update_own" on public.runs
  for update using (auth.uid() = user_id);
create policy "runs_delete_own" on public.runs
  for delete using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

create policy "documents_storage_select_own"
  on storage.objects for select
  using (bucket_id = 'documents' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "documents_storage_insert_own"
  on storage.objects for insert
  with check (bucket_id = 'documents' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "documents_storage_update_own"
  on storage.objects for update
  using (bucket_id = 'documents' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "documents_storage_delete_own"
  on storage.objects for delete
  using (bucket_id = 'documents' and auth.uid()::text = (storage.foldername(name))[1]);

-- Allow signed-in users to permanently delete their own account
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  delete from storage.objects
  where bucket_id = 'documents'
    and (storage.foldername(name))[1] = uid::text;

  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;
