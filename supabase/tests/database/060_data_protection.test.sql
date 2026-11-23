-- Data protection features: consent records, the contact form, retention and erasure.
begin;
select * from no_plan();
select tests.create_cast();

-- Consent
select tests.login('aisha@traders.example');
select public.submit_application('paisley', tests.application('{"marketing_opt_in":true}'));
select is(
  (select array_agg(purpose::text || ':' || granted::text order by purpose) from public.consents),
  array['privacy_policy:true', 'marketing:true'], 'submitting records the privacy acceptance and the marketing choice');
select is((select wording from public.consents where purpose = 'marketing'),
  (select marketing_wording from public.markets where slug = 'paisley'), 'with the exact wording shown');
select is((select public.set_marketing_consent('paisley', false) ->> 'granted'), 'false', 'consent can be withdrawn in one call');
select public.set_marketing_consent('paisley', false);
select is((select count(*)::int from public.consents where purpose = 'marketing'), 2,
  'a withdrawal is a new row; repeating the same choice adds nothing');
select throws_ok($$ update public.consents set granted = true $$, '42501', null, 'consent history cannot be edited');
select throws_ok($$ delete from public.consents $$, '42501', null, 'or deleted');

select tests.login('ben@traders.example');
select public.submit_application('paisley', tests.application('{"business_name":"Ben''s Baubles","category":"decorations","contact_name":"Ben Carter"}'));
select is((select granted from public.consents where purpose = 'marketing'), false,
  'marketing is off unless the trader ticks the box');
select tests.logout();

-- Contact form and data protection concerns
select tests.as_anon();
select is(
  (select public.submit_enquiry('paisley', 'data_protection', 'Please tell me what data you hold about me.', 'Sam', 'Sam@Example.com') ->> 'type'),
  'data_protection', 'a visitor can raise a data protection concern');
select throws_ok($$ select public.submit_enquiry('paisley', 'general', 'Too short') $$, '23514', null, 'a message must be at least 10 characters');
select throws_ok($$ select * from public.enquiries $$, '42501', null, 'visitors cannot read enquiries');
select tests.login('aisha@traders.example');
select is((select count(*)::int from public.enquiries), 0, 'traders cannot read enquiries');
select tests.login('admin@clyde.example');
select is((select count(*)::int from public.enquiries), 0, 'nor can another market''s administrator');
select tests.login('admin@paisley.example');
select is((select email from public.enquiries), 'sam@example.com', 'the market''s administrator can');
select isnt_empty($$ update public.enquiries set status = 'acknowledged', acknowledged_at = now() returning 1 $$,
  'and can mark the concern as acknowledged');
select tests.logout();

-- Retention
select tests.decide('Gleniffer Candle Co.', 'approved');
select tests.decide('Ben''s Baubles', 'rejected', 'The decorations category is full this year.');
select tests.login('aisha@traders.example');
select throws_ok($$ select public.purge_expired_data() $$, '42501', null, 'users cannot run the retention job');
select tests.as_service();
select is((select (public.purge_expired_data() ->> 'applications_deleted')::int), 0,
  'nothing is deleted while the retention period is still running');
select tests.logout();

-- Pretend the market finished seven months ago.
alter table public.applications disable trigger applications_guard;
update public.markets set start_date = current_date - 240, end_date = current_date - 215 where slug = 'paisley';
alter table public.applications enable trigger applications_guard;
update public.enquiries set created_at = now() - interval '13 months';
update public.audit_log set created_at = now() - interval '13 months' where action = 'application_submitted';

select tests.as_service();
create temporary table purge_result on commit drop as select public.purge_expired_data() as r;
select is((select (r ->> 'applications_deleted')::int from purge_result), 1, 'the rejected application is deleted after the retention period');
select is((select (r ->> 'enquiries_deleted')::int from purge_result), 1, 'old enquiries are deleted');
select is((select (r ->> 'audit_rows_deleted')::int from purge_result), 2, 'old audit rows are deleted');
select tests.logout();
select is((select array_agg(business_name) from public.applications), array['Gleniffer Candle Co.'], 'the approved application is kept');
select is(
  (select array_agg(category || ':' || status || ':' || total order by category) from public.market_statistics),
  array['crafts_gifts:approved:1', 'decorations:rejected:1'], 'anonymous totals are saved before deletion');
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'market_statistics' and column_name in ('trader_id', 'business_name', 'application_id')),
  0, 'the saved totals contain nothing that identifies a trader');

-- Erasure: deleting the account removes everything linked to it
delete from auth.users where email = 'aisha@traders.example';
select is((select count(*)::int from public.profiles where contact_name = 'Aisha Rahman'), 0, 'deleting an account removes the profile');
select is((select count(*)::int from public.applications), 0, 'the applications');
select is((select count(*)::int from public.application_days), 0, 'the chosen market days');
select is((select count(*)::int from public.consents c where not exists (select 1 from auth.users u where u.id = c.trader_id)), 0,
  'and the consent history');
select is((select count(*)::int from public.audit_log where action = 'application_deleted'), 2,
  'while the audit log keeps a record that the deletions happened');

select * from finish();
rollback;
