begin;

alter table public.user_onboarding_profiles
  add column if not exists answers_v2 jsonb not null default '{}'::jsonb;

alter table public.user_onboarding_profiles
  drop constraint if exists onboarding_completion_check;
alter table public.user_onboarding_profiles
  add constraint onboarding_completion_check check (
    (status = 'draft' and completed_at is null) or
    (status = 'completed' and completed_at is not null and (
      answers_v2 <> '{}'::jsonb or
      (q1_role is not null and q2_business is not null and q3_industry is not null
       and q4_team_size is not null and cardinality(q5_challenges) between 1 and 3
       and q6_first_goal is not null and cardinality(q7_departments) >= 1
       and q8_ai_familiarity is not null and q9_work_style is not null
       and q10_response_style is not null and q11_priority is not null
       and q13_discovery_source is not null and q14_trial_reason is not null)
    ))
  );

create or replace function public.save_onboarding_answers_v2(p_answers jsonb, p_complete boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_key text;
  v_allowed text[];
  v_value text;
  v_other jsonb;
begin
  if v_user is null then raise exception 'Sign in first.'; end if;
  if jsonb_typeof(p_answers) <> 'object' then raise exception 'Invalid onboarding answers.'; end if;
  if length(coalesce(p_answers->>'businessName','')) > 120 then raise exception 'Business name must be 120 characters or less.'; end if;
  v_other := p_answers->'otherAnswers';
  if jsonb_typeof(v_other) <> 'object' then raise exception 'Invalid custom answers.'; end if;
  for v_key, v_allowed in select * from (values
    ('q1', array['starting_business','small_business','existing_company','other']),
    ('q2', array['technology_saas','ecommerce_retail','services_agency','other']),
    ('q3', array['idea','building','first_customers','other']),
    ('q4', array['b2c','b2b','both','other']),
    ('q5', array['sales','brand_content','automate','other']),
    ('q6', array['sales_followups','marketing_content','team_admin','other']),
    ('q7', array['do_tasks','guide','recommend','other'])
  ) as choices(answer_key, allowed_values) loop
    v_value := p_answers->>v_key;
    -- The screen saves a draft after every answer, so a draft may still have
    -- unanswered questions. Anything present must be valid; completeness is
    -- only demanded when finishing.
    if v_value is null then
      if p_complete then raise exception 'Choose a valid answer for question %.', substring(v_key from 2); end if;
      continue;
    end if;
    if length(v_value) > 64 or not (v_value = any(v_allowed)) then
      raise exception 'Choose a valid answer for question %.', substring(v_key from 2);
    end if;
    if p_complete and v_value = 'other' and length(btrim(coalesce(v_other->>v_key,''))) = 0 then
      raise exception 'Add your answer for question %.', substring(v_key from 2);
    end if;
    if length(coalesce(v_other->>v_key,'')) > 120 then raise exception 'Custom answers must be 120 characters or less.'; end if;
  end loop;
  if p_complete and length(btrim(coalesce(p_answers->>'businessName',''))) = 0 then
    raise exception 'Enter your business name to continue.';
  end if;
  update public.user_onboarding_profiles
    set answers_v2 = p_answers,
        schema_version = 2,
        status = case when p_complete then 'completed' else 'draft' end
    where user_id = v_user;
  if not found then raise exception 'Onboarding profile was not found.'; end if;
end;
$$;

revoke all on function public.save_onboarding_answers_v2(jsonb, boolean) from public, anon;
grant execute on function public.save_onboarding_answers_v2(jsonb, boolean) to authenticated;
revoke insert, update on public.user_onboarding_profiles from authenticated;
grant select on public.user_onboarding_profiles to authenticated;

commit;
