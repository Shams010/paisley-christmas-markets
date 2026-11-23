-- Row Level Security: each trader sees only their own data, each administrator
-- only their own market, and visitors only the public listing.
begin;
select * from no_plan();
select tests.create_cast();

-- Aisha applies to the Paisley market
select tests.login('aisha@traders.example');
select lives_ok($$ select public.submit_application('paisley', tests.application()) $$, 'a trader can submit an application');
select is((select count(*)::int from public.applications), 1, 'the trader sees their own application');
select is((select count(*)::int from public.application_days), 2, 'and the two market days they chose');
select is((select contact_name from public.profiles), 'Aisha Rahman', 'contact details are saved on their profile');

-- Ben, another trader, cannot see or change any of it
select tests.login('ben@traders.example');
select is((select count(*)::int from public.applications), 0, 'another trader cannot see the application');
select is((select count(*)::int from public.application_details), 0, 'nor through the details view');
select is((select count(*)::int from public.profiles), 0, 'nor the applicant''s contact details');
select is((select count(*)::int from public.application_days), 0, 'nor their market days');
select is((select count(*)::int from public.consents), 0, 'nor their consent history');
select is_empty($$ update public.applications set business_name = 'Hacked' returning 1 $$, 'another trader cannot edit the application');
select throws_ok(
  format($$ insert into public.application_days (application_id, market_day_id, market_id) values (%s, %s, %L) $$,
         tests.app_id('Gleniffer Candle Co.'), tests.day_id('paisley', '2026-12-12'), tests.market_id('paisley')),
  '42501', null, 'another trader cannot add days to it');
select throws_ok(
  format($$ insert into public.applications (market_id, trader_id, business_name, postcode, category, description, stall_type,
              needs_power, insurance_expiry, is_over_18, accept_privacy_policy)
            values (%L, %L, 'Forged', 'PA1 1AA', 'other', 'An application created in someone else''s name.', 'gazebo_3x3',
              false, '2027-06-01', true, true) $$, tests.market_id('paisley'), tests.user_id('aisha@traders.example')),
  '42501', null, 'a trader cannot create an application in someone else''s name');
select throws_ok(
  format($$ select public.admin_get_trader_email(%s) $$, tests.app_id('Gleniffer Candle Co.')),
  'P0001', 'application_not_found', 'a trader cannot look up another trader''s email address');

-- Visitors
select tests.as_anon();
select throws_ok($$ select * from public.applications $$, '42501', null, 'visitors cannot read applications at all');
select throws_ok($$ select * from public.profiles $$, '42501', null, 'visitors cannot read profiles');
select throws_ok($$ select * from public.audit_log $$, '42501', null, 'visitors cannot read the audit log');
select is((select count(*)::int from public.public_traders), 0, 'an application that is not approved is not listed publicly');
select is((select count(*)::int from public.markets), 2, 'visitors can read market information');
select is((select count(*)::int from public.market_days where market_id = tests.market_id('paisley')), 8, 'and market days');

-- Administrators: own market only
select tests.login('admin@clyde.example');
select is((select count(*)::int from public.applications), 0, 'an administrator of another market cannot see the application');
select is((select count(*)::int from public.profiles), 0, 'nor the trader''s profile');
select is_empty($$ update public.applications set status = 'under_review' returning 1 $$, 'nor change its status');
select throws_ok(
  format($$ select public.admin_get_trader_email(%s) $$, tests.app_id('Gleniffer Candle Co.')),
  'P0001', 'application_not_found', 'nor look up the trader''s email');
select throws_ok(
  format($$ select public.admin_stats(%L) $$, tests.market_id('paisley')),
  'P0001', 'forbidden', 'nor read another market''s statistics');
select is_empty($$ update public.markets set name = 'Renamed' where slug = 'paisley' returning 1 $$, 'nor edit another market''s details');

select tests.login('admin@paisley.example');
select is((select count(*)::int from public.applications), 1, 'the market''s own administrator sees the application');
select is((select contact_name from public.application_details), 'Aisha Rahman', 'with the trader''s contact name');
select is(
  (select public.admin_get_trader_email(tests.app_id('Gleniffer Candle Co.'))), 'aisha@traders.example',
  'and can look up the email address to contact them');
select isnt_empty($$ update public.markets set applications_open = false where slug = 'paisley' returning 1 $$, 'an administrator can close applications for their own market');
select throws_ok($$ update public.markets set slug = 'other' $$, '42501', null, 'but cannot change the market''s slug');
select tests.logout();

-- A user cannot make themselves an administrator by editing user_metadata: the
-- role is only read from app_metadata.
select tests.create_user('sneaky@traders.example');
update auth.users set raw_user_meta_data = jsonb_build_object('role', 'admin', 'market_id', tests.market_id('paisley'))
where email = 'sneaky@traders.example';
select tests.login('sneaky@traders.example');
select is(public.is_market_admin(tests.market_id('paisley')), false, 'user_metadata does not grant the admin role');
select is((select count(*)::int from public.applications), 0, 'so they still see nothing');
select tests.logout();

-- After approval the listing becomes public, with listing fields only
select tests.decide('Gleniffer Candle Co.', 'approved');
select tests.as_anon();
select is((select business_name from public.public_traders), 'Gleniffer Candle Co.', 'an approved trader appears in the public directory');
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
   where table_schema = 'public' and table_name = 'public_traders'),
  array['id', 'market_id', 'business_name', 'category', 'category_label', 'description', 'website_url',
        'social_link', 'logo_path', 'stalls'],
  'the public view exposes listing fields only (no contact details, postcode or documents)');
select tests.logout();

select * from finish();
rollback;
