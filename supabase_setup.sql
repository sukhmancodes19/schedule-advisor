-- Run this once in the Supabase SQL Editor (SQL Editor > New query)

-- Tasks: kanban cards + calendar events, one row per task, scoped per user
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  time text default '',
  description text default '',
  status text not null default 'todo',
  color text,
  image_url text,
  created_at timestamptz default now()
);

alter table public.tasks enable row level security;

create policy "Users can view their own tasks"
  on public.tasks for select
  using (auth.uid() = user_id);

create policy "Users can insert their own tasks"
  on public.tasks for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own tasks"
  on public.tasks for update
  using (auth.uid() = user_id);

create policy "Users can delete their own tasks"
  on public.tasks for delete
  using (auth.uid() = user_id);

-- Messages: full chat history, scoped per user, so the AI's conversation
-- and schedule context persist across logins and devices
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  content text not null,
  created_at timestamptz default now()
);

alter table public.messages enable row level security;

create policy "Users can view their own messages"
  on public.messages for select
  using (auth.uid() = user_id);

create policy "Users can insert their own messages"
  on public.messages for insert
  with check (auth.uid() = user_id);

-- (Image attachments are stored as base64 directly in tasks.image_url for now —
-- no Supabase Storage bucket needed.)
