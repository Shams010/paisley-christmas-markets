-- The application workflow: what a submission must contain and who may move
-- an application from one status to the next.
begin;
select * from no_plan();
select tests.create_cast();

-- Submitting
select tests.as_anon();
select throws_ok($$ select public.submit_application('paisley', tests.application()) $$,
  '42501', null, 'a visitor who is not logged in cannot apply');

select tests.login('aisha@traders.example');
select throws_ok($$ select public.submit_application('no-such-market', tests.application()) $$,
  'P0001', 'market_not_found', 'unknown market is rejected');
select throws_ok($$ select public.submit_application('paisley', tests.application('{"category":"fireworks"}')) $$,
  'P0001', 'invalid_category', 'a category the market does not offer is rejected');
select throws_ok($$ select public.submit_application('paisley', tests.application('{"stall_type":"marquee"}')) $$,
  'P0001', 'invalid_stall_type', 'a stall type the market does not offer is rejected');
select throws_ok($$ select public.submit_application('paisley', tests.application('{"market_days":[]}')) $$,
  'P0001', 'invalid_market_days', 'at least one market day is required');
select throws_ok($$ select public.submit_application('paisley', tests.application('{"market_days":["2026-12-25"]}')) $$,
  'P0001', 'invalid_market_days', 'a date that is not a market day is rejected');
select throws_ok($$ select public.submit_application('paisley', tests.application('{"insurance_expiry":"2026-12-20"}')) $$,
  'P0001', 'insurance_expires_too_early', 'insurance must run past the last market day');
select throws_ok($$ select public.submit_application('paisley', tests.application('{"needs_power":true,"power_requirement":"none"}')) $$,
  '23514', null, 'needs_power and power_requirement must agree');
select throws_ok($$ select public.submit_application('paisley', tests.application('{"is_over_18":false}')) $$,
  '23514', null, 'the applicant must confirm they are over 18');
select throws_ok($$ select public.submit_application('paisley', tests.application('{"accept_privacy_policy":false}')) $$,
  '23514', null, 'the privacy notice must be accepted');
select throws_ok($$ select public.submit_application('paisley', tests.application('{"description":"Too short"}')) $$,
  '23514', null, 'the description must be at least 20 characters');
select throws_ok($$ select public.submit_application('paisley', tests.application('{"website_url":"http://insecure.example"}')) $$,
  '23514', null, 'the website must be an https link');
select throws_ok($$ select public.submit_application('paisley', tests.application('{"category":"food_drink"}')) $$,
  'P0001', 'food_registration_required', 'food traders must upload a food business registration');
select is((select count(*)::int from public.applications), 0, 'a failed submission saves nothing');
select is((select count(*)::int from public.consents), 0, 'not even a consent record (single transaction)');

select is(
  (select public.submit_application('paisley', tests.application('{"postcode":"pa2 8ab","needs_power":true,"power_requirement":"one_socket"}')) ->> 'status'),
  'submitted', 'a valid application is accepted with status submitted');
select is((select postcode from public.applications), 'PA2 8AB', 'the postcode is stored in upper case');
select throws_ok($$ select public.submit_application('paisley', tests.application()) $$,
  'P0001', 'application_exists', 'a second live application for the same market is rejected');

-- What a trader may and may not change
select throws_ok($$ update public.applications set status = 'approved' $$,
  'P0001', 'invalid_status_transition', 'a trader cannot approve their own application');
select throws_ok($$ update public.applications set admin_note = 'Looks great' $$,
  'P0001', 'forbidden_field', 'a trader cannot write the administrator''s note');
select throws_ok($$ update public.applications set market_id = tests.market_id('clyde-coast-food-festival') $$,
  'P0001', 'immutable_field', 'an application cannot be moved to another market');
select lives_ok(
  format($$ select public.update_application(%s, tests.application('{"business_name":"Gleniffer Candles","market_days":["2026-12-12"]}')) $$,
         tests.app_id('Gleniffer Candle Co.')),
  'a trader can edit their application while it is open');
select is((select business_name from public.applications), 'Gleniffer Candles', 'the edit is saved');
select is((select market_days from public.application_details), '["2026-12-12"]'::jsonb, 'and the market days are replaced');
select tests.logout();

-- A row inserted directly (not through the function) still starts at "submitted".
select tests.login('ben@traders.example');
insert into public.profiles (id) values (tests.user_id('ben@traders.example'));
insert into public.applications (market_id, trader_id, business_name, postcode, category, description, stall_type,
  needs_power, insurance_expiry, is_over_18, accept_privacy_policy, status, admin_note)
values (tests.market_id('paisley'), tests.user_id('ben@traders.example'), 'Ben''s Bakes', 'PA3 2BB', 'other',
  'Tray bakes and shortbread baked in Renfrew every morning.', 'gazebo_3x3', false, '2027-06-01', true, true,
  'approved', 'self-approved');
select is((select status::text || '/' || coalesce(admin_note, 'no note') from public.applications), 'submitted/no note',
  'a trader cannot insert an application that is already approved');
select tests.logout();

-- What an administrator may and may not change
select tests.login('admin@paisley.example');
select throws_ok(format($$ update public.applications set status = 'approved' where id = %s $$, tests.app_id('Gleniffer Candles')),
  'P0001', 'invalid_status_transition', 'an application cannot skip the review step');
select throws_ok(format($$ update public.applications set business_name = 'Edited by admin' where id = %s $$, tests.app_id('Gleniffer Candles')),
  'P0001', 'admin_cannot_edit_application', 'an administrator cannot rewrite what the trader submitted');
select lives_ok(format($$ update public.applications set status = 'under_review' where id = %s $$, tests.app_id('Gleniffer Candles')),
  'an administrator can start the review');
select throws_ok(format($$ update public.applications set status = 'rejected' where id = %s $$, tests.app_id('Gleniffer Candles')),
  'P0001', 'admin_note_required', 'rejecting needs a reason');
select throws_ok(format($$ update public.applications set status = 'changes_requested', admin_note = 'no' where id = %s $$, tests.app_id('Gleniffer Candles')),
  'P0001', 'admin_note_required', 'and a real one');
select lives_ok(
  format($$ update public.applications set status = 'changes_requested', admin_note = 'Please confirm your stall size.' where id = %s $$,
         tests.app_id('Gleniffer Candles')),
  'an administrator can ask for changes');

-- The trader responds, which resubmits the application.
select tests.login('aisha@traders.example');
select is(
  (select public.update_application(tests.app_id('Gleniffer Candles'), tests.application('{"business_name":"Gleniffer Candles"}')) ->> 'status'),
  'submitted', 'editing after a change request resubmits the application');

select tests.login('admin@paisley.example');
update public.applications set status = 'under_review' where id = tests.app_id('Gleniffer Candles');
update public.applications set status = 'approved' where id = tests.app_id('Gleniffer Candles');
select is((select status from public.applications where id = tests.app_id('Gleniffer Candles')), 'approved'::public.application_status,
  'an administrator can approve after review');
select isnt((select decided_at from public.applications where id = tests.app_id('Gleniffer Candles')), null,
  'the decision time is recorded');
select throws_ok(format($$ update public.applications set status = 'rejected', admin_note = 'Changed our minds.' where id = %s $$, tests.app_id('Gleniffer Candles')),
  'P0001', 'invalid_status_transition', 'a decision is final');

-- Once decided, the trader can no longer edit or withdraw.
select tests.login('aisha@traders.example');
select throws_ok(format($$ select public.update_application(%s, tests.application()) $$, tests.app_id('Gleniffer Candles')),
  'P0001', 'application_locked', 'an approved application cannot be edited');
select throws_ok($$ update public.applications set status = 'withdrawn' $$,
  'P0001', 'invalid_status_transition', 'or withdrawn');

-- Withdrawing before a decision, then applying again.
select tests.login('ben@traders.example');
select lives_ok($$ update public.applications set status = 'withdrawn' $$, 'a trader can withdraw before a decision');
select lives_ok($$ select public.submit_application('paisley', tests.application('{"business_name":"Ben''s Bakes Again"}')) $$,
  'and apply again afterwards');

-- An administrator cannot approve their own application.
select tests.login('admin@paisley.example');
select public.submit_application('paisley', tests.application('{"business_name":"Admin Side Hustle"}'));
select throws_ok(format($$ update public.applications set status = 'under_review' where id = %s $$, tests.app_id('Admin Side Hustle')),
  'P0001', 'invalid_status_transition', 'an administrator cannot review their own application');

-- Closed markets.
update public.markets set applications_open = false where slug = 'paisley';
select tests.create_user('late@traders.example');
select tests.login('late@traders.example');
select throws_ok($$ select public.submit_application('paisley', tests.application()) $$,
  'P0001', 'applications_closed', 'nobody can apply once applications are closed');
select tests.logout();

-- The audit trail
select is(
  (select array_agg(l.action order by l.id) from public.audit_log l where l.entity_id = tests.app_id('Gleniffer Candles')),
  array['application_submitted', 'application_under_review', 'application_changes_requested', 'application_submitted',
        'application_under_review', 'application_approved'],
  'every status change is written to the audit log in order');
select is(
  (select l.actor_id from public.audit_log l where l.entity_id = tests.app_id('Gleniffer Candles') and l.action = 'application_approved'),
  tests.user_id('admin@paisley.example'), 'with the administrator who made it');
select is(
  (select count(*)::int from public.audit_log l where l.detail::text ~* 'aisha|rahman|07700|PA2'), 0,
  'and no personal details are copied into the log');
select tests.login('aisha@traders.example');
select is((select count(*)::int from public.audit_log), 0, 'traders cannot read the audit log');
select throws_ok(
  format($$ insert into public.audit_log (market_id, action, entity) values (%L, 'forged', 'application') $$, tests.market_id('paisley')),
  '42501', null, 'or write to it');
select tests.logout();

select * from finish();
rollback;
