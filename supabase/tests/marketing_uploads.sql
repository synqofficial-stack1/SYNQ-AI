-- Rollback-only regression: persistent metadata remains available on a fresh
-- read, and private upload metadata/storage objects stay owner-isolated.
begin;
set local request.jwt.claim.role='service_role';
do $$
declare
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); media_id uuid:=gen_random_uuid(); n integer;
begin
  insert into auth.users(id,email) values (a,a||'@example.invalid'),(b,b||'@example.invalid');
  insert into public.marketing_media(id,user_id,filename,content_type,size_bytes,storage_path)
    values(media_id,a,'reload-test.mp4','video/mp4',2048,a||'/reload-test.mp4');
  insert into storage.objects(bucket_id,name) values('marketing-uploads',a||'/reload-test.mp4');

  perform set_config('request.jwt.claim.sub',a::text,true); set local role authenticated;
  -- Two independent reads model mounting the Marketing page again after reload.
  select count(*) into n from public.marketing_media where id=media_id and storage_path=a||'/reload-test.mp4';
  if n<>1 then raise exception 'Owner could not retrieve saved upload metadata'; end if;
  select count(*) into n from public.marketing_media where id=media_id;
  if n<>1 then raise exception 'Saved upload disappeared on a subsequent read'; end if;
  select count(*) into n from storage.objects where bucket_id='marketing-uploads' and name=a||'/reload-test.mp4';
  if n<>1 then raise exception 'Owner cannot access their private video object'; end if;
  reset role;

  perform set_config('request.jwt.claim.sub',b::text,true); set local role authenticated;
  select count(*) into n from public.marketing_media where id=media_id;
  if n<>0 then raise exception 'A different user can read private upload metadata'; end if;
  select count(*) into n from storage.objects where bucket_id='marketing-uploads' and name=a||'/reload-test.mp4';
  if n<>0 then raise exception 'A different user can read the private video object'; end if;
  reset role;
  raise notice 'Marketing upload persistence and user isolation passed';
end $$;
rollback;
