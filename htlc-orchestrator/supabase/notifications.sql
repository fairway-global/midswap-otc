-- KAAMOS notifications 
-- Lives in Supabase Postgres (NOT in the SQLite swaps.db) because it powers
-- the in-app bell via Supabase Realtime, which requires Postgres logical
-- replication. The orchestrator inserts rows via the service-role client
-- (bypasses RLS); signed-in clients SELECT/UPDATE their own rows via the
-- anon client (RLS-gated by auth.uid()).
--
-- Idempotent — safe to re-run.

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  rfq_id      text,
  swap_hash   text,
  type        text not null,
  title       text not null,
  body        text,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_recent_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;

alter table public.notifications enable row level security;

-- SELECT: a user sees only their own rows. This is what makes the Realtime
-- filter `user_id=eq.<uid>` safe — the broadcast layer re-applies SELECT.
drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
  on public.notifications for select
  using (auth.uid() = user_id);

-- UPDATE: a user can only mark their own rows as read.
drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
  on public.notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- No INSERT/DELETE policy — the service role bypasses RLS for INSERTs from
-- the orchestrator, and we never delete (use read_at to hide read items).

-- Realtime: add the table to the default publication so INSERTs broadcast
-- to subscribers. Wrapped in a DO block so re-runs don't error.
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception
  when duplicate_object then null;
end $$;
