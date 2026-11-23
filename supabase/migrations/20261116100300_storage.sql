-- Documents are private, limits are set on the buckets so uploads straight to Storage can't skip them.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('trader-documents', 'trader-documents', false, 5242880,
   array['application/pdf', 'image/jpeg', 'image/png']),
  ('trader-logos', 'trader-logos', true, 2097152,
   array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Paths are <user id>/<file name>
create policy "Traders upload into their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('trader-documents', 'trader-logos')
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "Traders read their own files"
  on storage.objects for select to authenticated
  using (
    bucket_id in ('trader-documents', 'trader-logos')
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

