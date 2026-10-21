create table public.generated_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  department text not null check (department in ('sales', 'marketing')),
  prompt text not null check (char_length(prompt) between 1 and 4000),
  storage_path text not null,
  created_at timestamptz not null default now()
);
create index generated_images_owner_created on public.generated_images(user_id, created_at desc);
alter table public.generated_images enable row level security;
create policy "Owners read their generated images" on public.generated_images for select to authenticated using (auth.uid() = user_id);
-- Creation is performed only by the authenticated Edge Function with the service role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ai-images', 'ai-images', false, 15728640, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
create policy "Owners read their AI image files" on storage.objects for select to authenticated
using (bucket_id = 'ai-images' and (storage.foldername(name))[1] = auth.uid()::text);
