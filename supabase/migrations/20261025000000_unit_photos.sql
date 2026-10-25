-- Unit photos taken in the app.
--
-- Files live in the public "unit-photos" storage bucket; unit_photos records the
-- current photo for each unit so every client knows which units have one.
-- Only "photo editors" may add or replace photos. A device becomes an editor by
-- entering the photo code once (claim_photo_editor). Only the code's SHA-256 hash is stored.

create table public.photo_editors (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

create table public.unit_photos (
  unit_id text primary key,
  path text not null,
  thumb_path text not null,
  updated_at timestamptz not null default now(),
  uploaded_by uuid default auth.uid() references auth.users (id) on delete set null
);

create function public.is_photo_editor() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.photo_editors where user_id = auth.uid())
$$;

create function public.claim_photo_editor(code text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  if encode(sha256(convert_to(trim(code), 'UTF8')), 'hex') <> '7124c95c3cd51e0049878a9f04aa1427530115ae9bdcb2186864208c16919705' then
    return false;
  end if;
  insert into public.photo_editors (user_id) values (auth.uid()) on conflict do nothing;
  return true;
end $$;

revoke execute on function public.claim_photo_editor(text) from anon;
grant execute on function public.claim_photo_editor(text) to authenticated;

alter table public.photo_editors enable row level security;
alter table public.unit_photos enable row level security;

create policy "see own editor status" on public.photo_editors
  for select to authenticated using (user_id = auth.uid());

create policy "photos readable" on public.unit_photos
  for select to anon, authenticated using (true);
create policy "editors add photos" on public.unit_photos
  for insert to authenticated with check (public.is_photo_editor());
create policy "editors replace photos" on public.unit_photos
  for update to authenticated using (public.is_photo_editor()) with check (public.is_photo_editor());
create policy "editors remove photos" on public.unit_photos
  for delete to authenticated using (public.is_photo_editor());

alter publication supabase_realtime add table public.unit_photos;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('unit-photos', 'unit-photos', true, 2097152, array['image/webp', 'image/jpeg'])
on conflict (id) do nothing;

create policy "editors upload unit photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'unit-photos' and public.is_photo_editor());
create policy "editors delete unit photos" on storage.objects
  for delete to authenticated using (bucket_id = 'unit-photos' and public.is_photo_editor());
