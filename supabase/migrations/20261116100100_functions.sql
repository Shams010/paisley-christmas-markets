-- Kept in the database so they apply whoever calls it.
-- Every function in public is exposed as an RPC endpoint, so internal helpers live in their own schema.
create schema if not exists app_private;

-- Reads the role from app_metadata in the JWT.
create or replace function public.is_market_admin(p_market_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and (auth.jwt() -> 'app_metadata' ->> 'market_id') = p_market_id::text,
    false
  );
$$;

-- Anything that isn't a browser user: the API's secret key, cron jobs, the SQL editor.
create or replace function app_private.is_trusted_caller()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user not in ('authenticated', 'anon');
$$;

create or replace function app_private.fail(p_code text, p_detail text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = coalesce(p_detail, p_code);
end;
$$;

create or replace function app_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger markets_touch       before update on public.markets       for each row execute function app_private.touch_updated_at();
create trigger profiles_touch      before update on public.profiles      for each row execute function app_private.touch_updated_at();
create trigger announcements_touch before update on public.announcements for each row execute function app_private.touch_updated_at();

-- RLS decides which rows a user can touch; this trigger decides what they can change.

create or replace function app_private.applications_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_market_end      date;
  v_applications_open boolean;
  v_requires_food   boolean;
  v_trusted         boolean := app_private.is_trusted_caller();
  v_is_owner        boolean;
  v_is_admin        boolean;
  -- Columns an administrator is allowed to change.
  v_admin_columns   text[] := array['status', 'admin_note', 'decided_at', 'updated_at'];
begin
  select m.end_date, m.applications_open into v_market_end, v_applications_open
  from public.markets m where m.id = new.market_id;

  select c.requires_food_registration into v_requires_food
  from public.market_categories c where c.market_id = new.market_id and c.code = new.category;

  if tg_op = 'UPDATE' and not v_trusted
     and (new.market_id <> old.market_id or new.trader_id <> old.trader_id or new.submitted_at <> old.submitted_at) then
    perform app_private.fail('immutable_field', 'The market, owner and submission time of an application cannot be changed.');
  end if;

  -- Content rules apply to every caller, including trusted ones.
  if tg_op = 'INSERT' or new.status in ('submitted', 'under_review', 'changes_requested') then
    if coalesce(v_requires_food, false) and new.food_registration_path is null then
      perform app_private.fail('food_registration_required', 'Food and drink traders must upload their food business registration.');
    end if;
    if new.insurance_expiry <= v_market_end then
      perform app_private.fail('insurance_expires_too_early', 'Public liability insurance must be valid until after the last market day.');
    end if;
  end if;

  new.updated_at := now();

  if tg_op = 'INSERT' then
    if not v_trusted then
      if not coalesce(v_applications_open, false) then
        perform app_private.fail('applications_closed', 'Applications for this market are closed.');
      end if;
      -- Ignore any status or note the client tried to set on insert.
      new.status       := 'submitted';
      new.admin_note   := null;
      new.decided_at   := null;
      new.submitted_at := now();
    end if;
    return new;
  end if;

  if v_trusted then
    return new;
  end if;

  v_is_owner := (old.trader_id = auth.uid());
  v_is_admin := public.is_market_admin(old.market_id);

  if v_is_owner then
   
    if new.admin_note is distinct from old.admin_note or new.decided_at is distinct from old.decided_at then
      perform app_private.fail('forbidden_field', 'Only an administrator can set the note or decision date.');
    end if;

    if new.status = old.status then
      if old.status not in ('submitted', 'changes_requested') then
        perform app_private.fail('application_locked', 'This application can no longer be edited.');
      end if;
    elsif old.status = 'changes_requested' and new.status = 'submitted' then
      null;  -- resubmitting after changes were requested
    elsif new.status = 'withdrawn' and old.status in ('submitted', 'under_review', 'changes_requested') then
      null;  -- withdrawing before a decision
    else
      perform app_private.fail('invalid_status_transition',
        format('A trader cannot move an application from %s to %s.', old.status, new.status));
    end if;
    return new;
  end if;

  if v_is_admin then
    if (to_jsonb(new) - v_admin_columns) <> (to_jsonb(old) - v_admin_columns) then
      perform app_private.fail('admin_cannot_edit_application', 'Administrators can change the status and note only.');
    end if;

    if new.status <> old.status then
      if not (
        (old.status = 'submitted'    and new.status = 'under_review') or
        (old.status = 'under_review' and new.status in ('approved', 'rejected', 'changes_requested'))
      ) then
        perform app_private.fail('invalid_status_transition',
          format('An application cannot move from %s to %s.', old.status, new.status));
      end if;

      if new.status in ('rejected', 'changes_requested') and length(trim(coalesce(new.admin_note, ''))) < 5 then
        perform app_private.fail('admin_note_required', 'Give the trader a reason when rejecting or requesting changes.');
      end if;

      new.decided_at := case when new.status in ('approved', 'rejected') then now() else null end;
    else
      new.decided_at := old.decided_at;
    end if;
    return new;
  end if;

  perform app_private.fail('forbidden', 'You cannot change this application.');
  return null;
end;
$$;

create trigger applications_guard
  before insert or update on public.applications
  for each row execute function app_private.applications_guard();

-- SECURITY DEFINER because users have no insert grant on audit_log, so they can't forge or skip entries. Only ids and statuses are logged.
create or replace function app_private.audit_application()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    
    if exists (select 1 from public.markets m where m.id = old.market_id) then
      insert into public.audit_log (market_id, actor_id, action, entity, entity_id, detail)
      values (old.market_id, auth.uid(), 'application_deleted', 'application', old.id,
              jsonb_build_object('status_when_deleted', old.status));
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    insert into public.audit_log (market_id, actor_id, action, entity, entity_id, detail)
    values (new.market_id, auth.uid(), 'application_submitted', 'application', new.id,
            jsonb_build_object('to', new.status));
  elsif new.status <> old.status then
    insert into public.audit_log (market_id, actor_id, action, entity, entity_id, detail)
    values (new.market_id, auth.uid(), 'application_' || new.status, 'application', new.id,
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end;
$$;

create trigger applications_audit
  after insert or update or delete on public.applications
  for each row execute function app_private.audit_application();

-- A stall can only go to an approved application, on a day it applied for.
create or replace function app_private.allocations_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status public.application_status;
begin
  select a.status into v_status from public.applications a where a.id = new.application_id;
  if v_status is distinct from 'approved' then
    perform app_private.fail('application_not_approved', 'Only approved applications can be given a stall.');
  end if;
  if not exists (
    select 1 from public.application_days ad
    where ad.application_id = new.application_id and ad.market_day_id = new.market_day_id
  ) then
    perform app_private.fail('day_not_requested', 'The trader did not apply for this market day.');
  end if;
  return new;
end;
$$;

create trigger stall_allocations_guard
  before insert on public.stall_allocations
  for each row execute function app_private.allocations_guard();

create or replace function app_private.audit_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.stall_allocations := case when tg_op = 'DELETE' then old else new end;
begin
  if exists (select 1 from public.markets m where m.id = v_row.market_id) then
    insert into public.audit_log (market_id, actor_id, action, entity, entity_id, detail)
    values (v_row.market_id, auth.uid(),
            case when tg_op = 'DELETE' then 'stall_unallocated' else 'stall_allocated' end,
            'application', v_row.application_id,
            jsonb_build_object('stall_id', v_row.stall_id, 'market_day_id', v_row.market_day_id));
  end if;
  return v_row;
end;
$$;

create trigger stall_allocations_audit
  after insert or delete on public.stall_allocations
  for each row execute function app_private.audit_allocation();



-- Stops a trader attaching someone else's file by guessing its path: it must be in their own <user id>/ folder and actually exist in the bucket.
create or replace function app_private.assert_own_upload(p_bucket text, p_path text, p_field text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_path is null then
    return;
  end if;
  if p_path not like (auth.uid()::text || '/%')
     or not exists (select 1 from storage.objects o where o.bucket_id = p_bucket and o.name = p_path) then
    perform app_private.fail('invalid_upload', p_field);
  end if;
end;
$$;


create or replace function app_private.resolve_market_days(p_market_id uuid, p_dates jsonb)
returns bigint[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_dates date[];
  v_ids   bigint[];
begin
  if p_dates is null or jsonb_typeof(p_dates) <> 'array' or jsonb_array_length(p_dates) = 0 then
    perform app_private.fail('invalid_market_days', 'Choose at least one market day.');
  end if;

  select array_agg(distinct d.value::date) into v_dates from jsonb_array_elements_text(p_dates) as d(value);
  select array_agg(md.id order by md.day) into v_ids
  from public.market_days md where md.market_id = p_market_id and md.day = any (v_dates);

  if coalesce(array_length(v_ids, 1), 0) <> array_length(v_dates, 1) then
    perform app_private.fail('invalid_market_days', 'One or more of the chosen dates is not a market day.');
  end if;
  return v_ids;
end;
$$;

-- Only writes a row when the answer changes, so resubmitting doesn't fill the history with duplicates.
create or replace function app_private.record_consent(
  p_market_id uuid, p_purpose public.consent_purpose, p_granted boolean, p_wording text, p_version text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_latest boolean;
begin
  select c.granted into v_latest
  from public.consents c
  where c.trader_id = auth.uid() and c.market_id = p_market_id and c.purpose = p_purpose
  order by c.created_at desc, c.id desc
  limit 1;

  if v_latest is distinct from p_granted then
    insert into public.consents (market_id, trader_id, purpose, granted, wording, wording_version)
    values (p_market_id, auth.uid(), p_purpose, p_granted, p_wording, p_version);
  end if;
end;
$$;

-- One transaction for the whole submission, so a failure never leaves half an application behind. Not SECURITY DEFINER, so the caller's RLS still applies.
create or replace function public.submit_application(p_market_slug text, p_application jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_uid           uuid := auth.uid();
  v_market        public.markets;
  v_requires_food boolean;
  v_uses_lpg      boolean;
  v_day_ids       bigint[];
  v_app           public.applications;
begin
  if v_uid is null then
    perform app_private.fail('not_authenticated', 'Log in to apply.');
  end if;

  select * into v_market from public.markets m where m.slug = p_market_slug;
  if not found then
    perform app_private.fail('market_not_found', p_market_slug);
  end if;

  select c.requires_food_registration into v_requires_food
  from public.market_categories c
  where c.market_id = v_market.id and c.code = p_application ->> 'category';
  if not found then
    perform app_private.fail('invalid_category', 'category');
  end if;

  if not exists (
    select 1 from public.market_stall_types t
    where t.market_id = v_market.id and t.code = p_application ->> 'stall_type'
  ) then
    perform app_private.fail('invalid_stall_type', 'stall_type');
  end if;

  v_day_ids := app_private.resolve_market_days(v_market.id, p_application -> 'market_days');

  -- Food-only fields are ignored for other categories.
  v_uses_lpg := v_requires_food and coalesce((p_application ->> 'uses_lpg')::boolean, false);

  perform app_private.assert_own_upload('trader-documents',
    case when v_requires_food then p_application ->> 'food_registration' end, 'food_registration');
  perform app_private.assert_own_upload('trader-documents',
    case when v_uses_lpg then p_application ->> 'gas_safety_certificate' end, 'gas_safety_certificate');
  perform app_private.assert_own_upload('trader-logos', p_application ->> 'logo', 'logo');

  -- Contact details are kept on the profile.
  insert into public.profiles (id, contact_name, phone)
  values (v_uid, p_application ->> 'contact_name', p_application ->> 'phone')
  on conflict (id) do update
    set contact_name = excluded.contact_name, phone = excluded.phone;

  begin
    insert into public.applications (
      market_id, trader_id, business_name, postcode, category, description, stall_type,
      needs_power, power_requirement, uses_lpg, insurance_expiry, website_url, social_link,
      additional_requirements, food_registration_path, gas_safety_certificate_path, logo_path,
      is_over_18, accept_privacy_policy
    ) values (
      v_market.id, v_uid,
      p_application ->> 'business_name',
      upper(p_application ->> 'postcode'),
      p_application ->> 'category',
      p_application ->> 'description',
      p_application ->> 'stall_type',
      (p_application ->> 'needs_power')::boolean,
      coalesce((p_application ->> 'power_requirement')::public.power_requirement, 'none'),
      v_uses_lpg,
      (p_application ->> 'insurance_expiry')::date,
      nullif(p_application ->> 'website_url', ''),
      nullif(p_application ->> 'social_link', ''),
      nullif(p_application ->> 'additional_requirements', ''),
      case when v_requires_food then p_application ->> 'food_registration' end,
      case when v_uses_lpg then p_application ->> 'gas_safety_certificate' end,
      p_application ->> 'logo',
      coalesce((p_application ->> 'is_over_18')::boolean, false),
      coalesce((p_application ->> 'accept_privacy_policy')::boolean, false)
    )
    returning * into v_app;
  exception when unique_violation then
    perform app_private.fail('application_exists', 'You already have an application for this market.');
  end;

  insert into public.application_days (application_id, market_day_id, market_id)
  select v_app.id, d, v_market.id from unnest(v_day_ids) as d;

  perform app_private.record_consent(v_market.id, 'privacy_policy', true,
    'I have read and accept the privacy notice.', v_market.privacy_policy_version);
  perform app_private.record_consent(v_market.id, 'marketing',
    coalesce((p_application ->> 'marketing_opt_in')::boolean, false),
    v_market.marketing_wording, v_market.privacy_policy_version);

  return jsonb_build_object('id', v_app.id, 'status', v_app.status, 'submitted_at', v_app.submitted_at);
end;
$$;

-- Status is always set back to 'submitted', which is how an edit after changes_requested counts as a resubmission.
create or replace function public.update_application(p_application_id bigint, p_application jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_uid           uuid := auth.uid();
  v_app           public.applications;
  v_market        public.markets;
  v_requires_food boolean;
  v_uses_lpg      boolean;
  v_day_ids       bigint[];
begin
  select * into v_app from public.applications a
  where a.id = p_application_id and a.trader_id = v_uid
  for update;
  if not found then
    perform app_private.fail('application_not_found', p_application_id::text);
  end if;
  if v_app.status not in ('submitted', 'changes_requested') then
    perform app_private.fail('application_locked', 'This application can no longer be edited.');
  end if;

  select * into v_market from public.markets m where m.id = v_app.market_id;

  select c.requires_food_registration into v_requires_food
  from public.market_categories c
  where c.market_id = v_market.id and c.code = p_application ->> 'category';
  if not found then
    perform app_private.fail('invalid_category', 'category');
  end if;

  if not exists (
    select 1 from public.market_stall_types t
    where t.market_id = v_market.id and t.code = p_application ->> 'stall_type'
  ) then
    perform app_private.fail('invalid_stall_type', 'stall_type');
  end if;

  v_day_ids  := app_private.resolve_market_days(v_market.id, p_application -> 'market_days');
  v_uses_lpg := v_requires_food and coalesce((p_application ->> 'uses_lpg')::boolean, false);

  perform app_private.assert_own_upload('trader-documents',
    case when v_requires_food then p_application ->> 'food_registration' end, 'food_registration');
  perform app_private.assert_own_upload('trader-documents',
    case when v_uses_lpg then p_application ->> 'gas_safety_certificate' end, 'gas_safety_certificate');
  perform app_private.assert_own_upload('trader-logos', p_application ->> 'logo', 'logo');

  update public.profiles
  set contact_name = p_application ->> 'contact_name', phone = p_application ->> 'phone'
  where id = v_uid;

  update public.applications a set
    business_name               = p_application ->> 'business_name',
    postcode                    = upper(p_application ->> 'postcode'),
    category                    = p_application ->> 'category',
    description                 = p_application ->> 'description',
    stall_type                  = p_application ->> 'stall_type',
    needs_power                 = (p_application ->> 'needs_power')::boolean,
    power_requirement           = coalesce((p_application ->> 'power_requirement')::public.power_requirement, 'none'),
    uses_lpg                    = v_uses_lpg,
    insurance_expiry            = (p_application ->> 'insurance_expiry')::date,
    website_url                 = nullif(p_application ->> 'website_url', ''),
    social_link                 = nullif(p_application ->> 'social_link', ''),
    additional_requirements     = nullif(p_application ->> 'additional_requirements', ''),
    food_registration_path      = case when v_requires_food then p_application ->> 'food_registration' end,
    gas_safety_certificate_path = case when v_uses_lpg then p_application ->> 'gas_safety_certificate' end,
    logo_path                   = p_application ->> 'logo',
    status                      = 'submitted'
  where a.id = v_app.id
  returning * into v_app;

  delete from public.application_days ad where ad.application_id = v_app.id;
  insert into public.application_days (application_id, market_day_id, market_id)
  select v_app.id, d, v_market.id from unnest(v_day_ids) as d;

  if p_application ? 'marketing_opt_in' then
    perform app_private.record_consent(v_market.id, 'marketing',
      coalesce((p_application ->> 'marketing_opt_in')::boolean, false),
      v_market.marketing_wording, v_market.privacy_policy_version);
  end if;

  return jsonb_build_object('id', v_app.id, 'status', v_app.status, 'updated_at', v_app.updated_at);
end;
$$;

-- Backs the marketing on/off toggle in the frontend.
create or replace function public.set_marketing_consent(p_market_slug text, p_granted boolean)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_market public.markets;
begin
  if auth.uid() is null then
    perform app_private.fail('not_authenticated', 'Log in first.');
  end if;
  select * into v_market from public.markets m where m.slug = p_market_slug;
  if not found then
    perform app_private.fail('market_not_found', p_market_slug);
  end if;

  insert into public.profiles (id) values (auth.uid()) on conflict (id) do nothing;
  perform app_private.record_consent(v_market.id, 'marketing', p_granted,
    v_market.marketing_wording, v_market.privacy_policy_version);

  return jsonb_build_object('purpose', 'marketing', 'granted', p_granted);
end;
$$;

-- SECURITY DEFINER because visitors have no grant on enquiries at all. This is the only way in for them, and it can only insert.
create or replace function public.submit_enquiry(
  p_market_slug text, p_type public.enquiry_type, p_message text,
  p_name text default null, p_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_market_id uuid;
  v_row       public.enquiries;
begin
  select m.id into v_market_id from public.markets m where m.slug = p_market_slug;
  if not found then
    perform app_private.fail('market_not_found', p_market_slug);
  end if;

  insert into public.enquiries (market_id, type, name, email, message)
  values (v_market_id, p_type, nullif(trim(p_name), ''), nullif(trim(lower(p_email)), ''), trim(p_message))
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'type', v_row.type, 'created_at', v_row.created_at);
end;
$$;

-- Emails live in auth.users, which admins can't read directly. 
create or replace function public.admin_get_trader_email(p_application_id bigint)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_market_id uuid;
  v_trader_id uuid;
  v_email     text;
begin
  select a.market_id, a.trader_id into v_market_id, v_trader_id
  from public.applications a where a.id = p_application_id;

  if not found or not public.is_market_admin(v_market_id) then
    perform app_private.fail('application_not_found', p_application_id::text);
  end if;

  select u.email into v_email from auth.users u where u.id = v_trader_id;
  return v_email;
end;
$$;

-- RLS would already limit the counts, but the explicit check gives a proper error instead of a dashboard full of zeros.
create or replace function public.admin_stats(p_market_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  if not public.is_market_admin(p_market_id) then
    perform app_private.fail('forbidden', 'Administrators only.');
  end if;

  return jsonb_build_object(
    'total_applications', (select count(*) from public.applications a where a.market_id = p_market_id),
    'by_status', coalesce((
      select jsonb_object_agg(s.status, s.total)
      from (select a.status, count(*) as total from public.applications a
            where a.market_id = p_market_id group by a.status) s), '{}'::jsonb),
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object('category', c.code, 'label', c.label,
                                          'total', coalesce(t.total, 0), 'approved', coalesce(t.approved, 0))
                       order by c.sort_order)
      from public.market_categories c
      left join (select a.category, count(*) as total,
                        count(*) filter (where a.status = 'approved') as approved
                 from public.applications a where a.market_id = p_market_id group by a.category) t
             on t.category = c.code
      where c.market_id = p_market_id), '[]'::jsonb),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object(
               'date', d.day,
               'applications', (select count(*) from public.application_days ad
                                join public.applications a on a.id = ad.application_id
                                where ad.market_day_id = d.id and a.status not in ('withdrawn', 'rejected')),
               'stalls_allocated', (select count(*) from public.stall_allocations sa where sa.market_day_id = d.id),
               'stalls_total', (select count(*) from public.stalls s where s.market_id = p_market_id))
             order by d.day)
      from public.market_days d where d.market_id = p_market_id), '[]'::jsonb),
    'power', jsonb_build_object(
      'needs_power', (select count(*) from public.applications a
                      where a.market_id = p_market_id and a.needs_power and a.status = 'approved'),
      'uses_lpg', (select count(*) from public.applications a
                   where a.market_id = p_market_id and a.uses_lpg and a.status = 'approved')),
    'open_enquiries', (select count(*) from public.enquiries e
                       where e.market_id = p_market_id and e.status = 'new')
  );
end;
$$;



-- Saves anonymous totals to market_statistics, then deletes expired data. 
create or replace function public.purge_expired_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_market        record;
  v_files         jsonb := '[]'::jsonb;
  v_batch         jsonb;
  v_applications  integer := 0;
  v_enquiries     integer := 0;
  v_audit_rows    integer := 0;
  v_count         integer;
begin
  for v_market in
    select m.id, m.end_date, m.retention_unsuccessful_months, m.retention_enquiry_months, m.retention_audit_months
    from public.markets m
  loop
    
    if current_date > (v_market.end_date + make_interval(months => v_market.retention_unsuccessful_months))::date
       and exists (select 1 from public.applications a
                   where a.market_id = v_market.id and a.status in ('rejected', 'withdrawn')) then

      insert into public.market_statistics (market_id, recorded_on, category, status, total)
      select a.market_id, current_date, a.category, a.status, count(*)
      from public.applications a
      where a.market_id = v_market.id
      group by a.market_id, a.category, a.status
      on conflict (market_id, recorded_on, category, status) do update set total = excluded.total;

      with deleted as (
        delete from public.applications a
        where a.market_id = v_market.id and a.status in ('rejected', 'withdrawn')
        returning a.food_registration_path, a.gas_safety_certificate_path, a.logo_path
      ),
      files as (
        select 'trader-documents' as bucket, d.food_registration_path as path
        from deleted d where d.food_registration_path is not null
        union all
        select 'trader-documents', d.gas_safety_certificate_path
        from deleted d where d.gas_safety_certificate_path is not null
        union all
        select 'trader-logos', d.logo_path
        from deleted d where d.logo_path is not null
      )
      select (select count(*) from deleted)::integer,
             coalesce((select jsonb_agg(jsonb_build_object('bucket', f.bucket, 'path', f.path)) from files f), '[]'::jsonb)
      into v_count, v_batch;

      v_applications := v_applications + v_count;
      v_files := v_files || v_batch;
    end if;

    delete from public.enquiries e
    where e.market_id = v_market.id
      and e.created_at < now() - make_interval(months => v_market.retention_enquiry_months);
    get diagnostics v_count = row_count;
    v_enquiries := v_enquiries + v_count;

    delete from public.audit_log l
    where l.market_id = v_market.id
      and l.created_at < now() - make_interval(months => v_market.retention_audit_months);
    get diagnostics v_count = row_count;
    v_audit_rows := v_audit_rows + v_count;
  end loop;

  return jsonb_build_object(
    'applications_deleted', v_applications,
    'enquiries_deleted', v_enquiries,
    'audit_rows_deleted', v_audit_rows,
    'files', v_files
  );
end;
$$;

-- Files no application points to, e.g. uploaded and then the form was abandoned.

create or replace function public.orphaned_uploads(p_min_age interval default interval '1 day')
returns table (bucket text, path text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id, o.name
  from storage.objects o
  where o.bucket_id in ('trader-documents', 'trader-logos')
    and o.created_at < now() - p_min_age
    and not exists (
      select 1 from public.applications a
      where o.name in (a.food_registration_path, a.gas_safety_certificate_path, a.logo_path)
    );
$$;
