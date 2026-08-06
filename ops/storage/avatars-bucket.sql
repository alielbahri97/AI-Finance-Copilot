-- Public `avatars` bucket for profile photos.
-- Paste into Supabase → SQL Editor (production or staging). Idempotent.
--
-- Path convention: {userId}/avatar.{jpg|png|webp}
-- The app uploads with the user's session (anon key + RLS); URLs are public
-- so the header/profile can render them without signed URLs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users manage own avatar files" on storage.objects;
create policy "Users manage own avatar files"
on storage.objects for all to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Public read for anyone (bucket is public; this keeps SELECT explicit if
-- the project disables public policies by default).
drop policy if exists "Public read avatars" on storage.objects;
create policy "Public read avatars"
on storage.objects for select to public
using (bucket_id = 'avatars');

-- Verify:
-- select id, public, file_size_limit, allowed_mime_types
-- from storage.buckets where id = 'avatars';
--
-- select policyname, cmd, roles::text
-- from pg_policies
-- where schemaname = 'storage' and tablename = 'objects'
--   and policyname in ('Users manage own avatar files', 'Public read avatars');
