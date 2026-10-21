-- Existing prospect ownership policies also protect transcripts and reports.
alter table public.sales_runs add column if not exists call_questions jsonb not null default '[]'::jsonb;
alter table public.prospects
  add column if not exists call_transcript jsonb not null default '[]'::jsonb,
  add column if not exists call_duration_seconds integer,
  add column if not exists call_report jsonb,
  add column if not exists report_status text not null default 'pending'
    check (report_status in ('pending', 'processing', 'ready', 'failed')),
  add column if not exists report_started_at timestamptz,
  add column if not exists report_error text,
  add column if not exists recording_path text,
  add column if not exists recording_error text;

-- Recordings are served only through an owner-checked Edge Function.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('call-audio', 'call-audio', false, 26214400, array['audio/mpeg'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
