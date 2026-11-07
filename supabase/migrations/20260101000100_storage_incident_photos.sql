-- Bucket PRIVÉ pour les photos d'incident. Chemin attendu : <user_id>/<fichier>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('incident-photos','incident-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "incident photos insert own" on storage.objects;
create policy "incident photos insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'incident-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "incident photos read own or staff" on storage.objects;
create policy "incident photos read own or staff" on storage.objects for select to authenticated
  using (bucket_id = 'incident-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff()));
