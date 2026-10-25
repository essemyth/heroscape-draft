-- Storage only lets a user delete files it can also select, so editors need read
-- access through the API to clean up replaced photos. (Public URLs work without this.)
create policy "editors read unit photos" on storage.objects
  for select to authenticated using (bucket_id = 'unit-photos' and public.is_photo_editor());
