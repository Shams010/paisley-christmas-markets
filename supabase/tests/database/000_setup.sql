-- Test helpers, named 000 so it runs first. They switch role and set the JWT claims the
-- same way the Data API does, so RLS gets tested the way a real request would hit it.

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

create or replace function tests.create_user(p_email text, p_app_metadata jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_email, '',
          now(), p_app_metadata, '{}'::jsonb, now(), now());
  return v_id;
end;
$$;

create or replace function tests.user_id(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from auth.users u where u.email = p_email;
$$;

create or replace function tests.claims_for(p_email text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select json_build_object(
    'sub', u.id, 'role', 'authenticated', 'email', u.email, 'aud', 'authenticated',
    'app_metadata', u.raw_app_meta_data, 'user_metadata', u.raw_user_meta_data
  )::text
  from auth.users u where u.email = p_email;
$$;

-- Act as a logged-in user for the rest of the transaction (or until the next call).
create or replace function tests.login(p_email text)
returns void
language plpgsql
as $$
begin
  if tests.claims_for(p_email) is null then
    raise exception 'tests.login: no such user %', p_email;
  end if;
  perform set_config('request.jwt.claims', tests.claims_for(p_email), true);
  execute 'set local role authenticated';
end;
$$;

-- Act as a visitor who is not logged in.
create or replace function tests.as_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end;
$$;

-- Act as the API server using the secret key.
create or replace function tests.as_service()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end;
$$;

-- Back to the role running the test file.
create or replace function tests.logout()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end;
$$;

-- A valid Paisley application. Pass overrides to change individual fields.
create or replace function tests.application(p_overrides jsonb default '{}'::jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'business_name', 'Gleniffer Candle Co.',
    'contact_name', 'Aisha Rahman',
    'phone', '07700 900123',
    'postcode', 'PA2 8AB',
    'category', 'crafts_gifts',
    'description', 'Hand-poured soy candles and wax melts in winter scents, made in Paisley.',
    'stall_type', 'gazebo_3x3',
    'needs_power', false,
    'power_requirement', 'none',
    'uses_lpg', false,
    'market_days', jsonb_build_array('2026-12-05', '2026-12-06'),
    'insurance_expiry', '2027-03-31',
    'website_url', 'https://glenniffercandles.example',
    'is_over_18', true,
    'accept_privacy_policy', true,
    'marketing_opt_in', false
  ) || p_overrides;
$$;

-- Inserts into storage.objects as the current user, so the storage policies still apply.
create or replace function tests.upload(p_bucket text, p_path text)
returns void
language sql
as $$
  insert into storage.objects (bucket_id, name, owner_id) values (p_bucket, p_path, auth.uid()::text);
$$;

-- SECURITY DEFINER so these lookups work whichever role the test is acting as.
create or replace function tests.app_id(p_business_name text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select a.id from public.applications a where a.business_name = p_business_name order by a.id desc limit 1;
$$;

create or replace function tests.market_id(p_slug text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id from public.markets m where m.slug = p_slug;
$$;

create or replace function tests.day_id(p_slug text, p_day date)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select d.id from public.market_days d join public.markets m on m.id = d.market_id
  where m.slug = p_slug and d.day = p_day;
$$;

create or replace function tests.stall_id(p_slug text, p_code text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select s.id from public.stalls s join public.markets m on m.id = s.market_id
  where m.slug = p_slug and s.code = p_code;
$$;

-- Two traders plus one admin for each market.
create or replace function tests.create_cast()
returns void
language plpgsql
as $$
begin
  perform tests.create_user('aisha@traders.example');
  perform tests.create_user('ben@traders.example');
  perform tests.create_user('admin@paisley.example',
    jsonb_build_object('role', 'admin', 'market_id', tests.market_id('paisley')));
  perform tests.create_user('admin@clyde.example',
    jsonb_build_object('role', 'admin', 'market_id', tests.market_id('clyde-coast-food-festival')));
end;
$$;

-- Moves an application through the workflow as the Paisley administrator.
create or replace function tests.decide(p_business_name text, p_status public.application_status, p_note text default null)
returns void
language plpgsql
as $$
begin
  perform tests.login('admin@paisley.example');
  update public.applications set status = 'under_review' where id = tests.app_id(p_business_name) and status = 'submitted';
  update public.applications set status = p_status, admin_note = p_note where id = tests.app_id(p_business_name);
  perform tests.logout();
end;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

begin;
select plan(1);
select has_schema('tests', 'test helpers are installed');
select * from finish();
rollback;
