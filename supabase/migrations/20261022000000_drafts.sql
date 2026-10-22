-- Online drafts.
--
-- Clients read everything through RLS and get live updates via Realtime.
-- Clients may only edit lobby details (host: settings; players: their own seat).
-- Every draft action (start, pick, pass, timeout, undo) goes through the
-- draft-action edge function, which validates it with the shared rules and
-- writes with the service role.

create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  status text not null default 'lobby' check (status in ('lobby', 'drafting', 'complete')),
  -- Lobby settings: { format, pointsTotal, groups, timerSeconds, collectionId, playerOrder }
  settings jsonb not null,
  -- Full DraftState once the draft starts (see src/lib/types.ts).
  state jsonb,
  -- Bumped on every state change; actions must name the version they saw.
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.draft_players (
  draft_id uuid not null references public.drafts (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 40),
  -- Discord user id for turn pings, e.g. "123456789012345678".
  discord_id text check (discord_id ~ '^[0-9]{5,25}$'),
  joined_at timestamptz not null default now(),
  primary key (draft_id, user_id)
);

-- Only the host can see the webhook URL.
create table public.draft_secrets (
  draft_id uuid primary key references public.drafts (id) on delete cascade,
  discord_webhook text check (discord_webhook ~ '^https://(discord\.com|discordapp\.com)/api/webhooks/')
);

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger drafts_touch before update on public.drafts
for each row execute function public.touch_updated_at();

create function public.is_draft_host(p_draft_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.drafts where id = p_draft_id and host_id = auth.uid())
$$;

create function public.draft_in_lobby(p_draft_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.drafts where id = p_draft_id and status = 'lobby')
$$;

alter table public.drafts enable row level security;
alter table public.draft_players enable row level security;
alter table public.draft_secrets enable row level security;

-- Draft ids are unguessable, so anyone signed in with the link can watch.
create policy "drafts readable" on public.drafts
  for select to authenticated using (true);

create policy "host creates drafts" on public.drafts
  for insert to authenticated with check (host_id = auth.uid() and status = 'lobby' and state is null and version = 0);

-- Settings lock when the draft starts.
create policy "host edits lobby settings" on public.drafts
  for update to authenticated
  using (host_id = auth.uid() and status = 'lobby')
  with check (host_id = auth.uid() and status = 'lobby');

create policy "host deletes drafts" on public.drafts
  for delete to authenticated using (host_id = auth.uid());

-- Clients may only ever change the settings column; status/state/version are server-only.
revoke update on public.drafts from authenticated, anon;
grant update (settings) on public.drafts to authenticated;

create policy "players readable" on public.draft_players
  for select to authenticated using (true);

create policy "join lobby" on public.draft_players
  for insert to authenticated with check (user_id = auth.uid() and public.draft_in_lobby(draft_id));

create policy "edit own seat in lobby" on public.draft_players
  for update to authenticated
  using (user_id = auth.uid() and public.draft_in_lobby(draft_id))
  with check (user_id = auth.uid());

create policy "leave or kick in lobby" on public.draft_players
  for delete to authenticated
  using ((user_id = auth.uid() or public.is_draft_host(draft_id)) and public.draft_in_lobby(draft_id));

revoke update on public.draft_players from authenticated, anon;
grant update (name, discord_id) on public.draft_players to authenticated;

create policy "host manages secrets" on public.draft_secrets
  for all to authenticated
  using (public.is_draft_host(draft_id))
  with check (public.is_draft_host(draft_id));

alter publication supabase_realtime add table public.drafts, public.draft_players;
