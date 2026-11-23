-- Uploaded documents: private to the trader who uploaded them.
begin;
select * from no_plan();
select tests.create_cast();

select tests.login('aisha@traders.example');
select lives_ok(
  format($$ select tests.upload('trader-documents', %L) $$, tests.user_id('aisha@traders.example') || '/food-registration.pdf'),
  'a trader can upload a document into their own folder');
select lives_ok(
  format($$ select tests.upload('trader-documents', %L) $$, tests.user_id('aisha@traders.example') || '/gas-safety.pdf'),
  'and a second one');
select lives_ok(
  format($$ select tests.upload('trader-logos', %L) $$, tests.user_id('aisha@traders.example') || '/logo.png'),
  'and a logo');
select throws_ok(
  format($$ select tests.upload('trader-documents', %L) $$, tests.user_id('ben@traders.example') || '/planted.pdf'),
  '42501', null, 'but not into another trader''s folder');
select throws_ok($$ select tests.upload('some-other-bucket', 'x/y.pdf') $$, '42501', null, 'or into another bucket');
select is((select count(*)::int from storage.objects), 3, 'the trader sees their own files');
select is(
  (select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE', 'DELETE', 'ALL')),
  0, 'no policy lets a user replace or delete an uploaded document');

select tests.login('ben@traders.example');
select is((select count(*)::int from storage.objects), 0, 'another trader cannot see the files');
select throws_ok(
  format($$ select public.submit_application('paisley', tests.application(%L)) $$,
    jsonb_build_object('category', 'food_drink', 'food_registration', tests.user_id('aisha@traders.example') || '/food-registration.pdf')),
  'P0001', 'invalid_upload', 'or attach someone else''s document to their own application');
select throws_ok(
  format($$ select public.submit_application('paisley', tests.application(%L)) $$,
    jsonb_build_object('category', 'food_drink', 'food_registration', tests.user_id('ben@traders.example') || '/never-uploaded.pdf')),
  'P0001', 'invalid_upload', 'or a file that was never uploaded');

select tests.as_anon();
select throws_ok($$ select tests.upload('trader-documents', 'anon/file.pdf') $$, '42501', null, 'a visitor cannot upload');

select tests.login('admin@paisley.example');
select is((select count(*)::int from storage.objects), 0,
  'administrators have no direct access to documents (the API issues short-lived links instead)');

-- Food traders
select tests.login('aisha@traders.example');
select throws_ok(
  format($$ select public.submit_application('paisley', tests.application(%L)) $$,
    jsonb_build_object('category', 'food_drink', 'stall_type', 'food_van', 'uses_lpg', true,
      'food_registration', tests.user_id('aisha@traders.example') || '/food-registration.pdf')),
  '23514', null, 'a trader who uses LPG must upload a gas safety certificate');
select lives_ok(
  format($$ select public.submit_application('paisley', tests.application(%L)) $$,
    jsonb_build_object('business_name', 'Seedhill Street Food', 'category', 'food_drink', 'stall_type', 'food_van',
      'uses_lpg', true, 'needs_power', true, 'power_requirement', 'high_load',
      'food_registration', tests.user_id('aisha@traders.example') || '/food-registration.pdf',
      'gas_safety_certificate', tests.user_id('aisha@traders.example') || '/gas-safety.pdf',
      'logo', tests.user_id('aisha@traders.example') || '/logo.png')),
  'a complete food application with documents is accepted');
select is((select uses_lpg from public.applications), true, 'LPG use is recorded');
select isnt((select gas_safety_certificate_path from public.applications), null, 'with the certificate attached');

-- Non-food traders: food-only fields are ignored rather than stored.
select tests.login('ben@traders.example');
select public.submit_application('paisley', tests.application('{"business_name":"Ben''s Baubles","category":"decorations","uses_lpg":true}'));
select is((select uses_lpg from public.applications), false, 'uses_lpg is ignored for non-food categories');
select tests.logout();

-- Files nobody attached to an application are found by the clean-up job.
select tests.login('ben@traders.example');
select tests.upload('trader-documents', tests.user_id('ben@traders.example') || '/abandoned.pdf');
select tests.logout();
update storage.objects set created_at = now() - interval '3 days';
select tests.as_service();
select is(
  (select array_agg(path order by path) from public.orphaned_uploads()),
  array[tests.user_id('ben@traders.example') || '/abandoned.pdf'],
  'only the unattached upload is reported as orphaned');
select tests.login('ben@traders.example');
select throws_ok($$ select * from public.orphaned_uploads() $$, '42501', null, 'traders cannot run the clean-up query');
select tests.logout();

select * from finish();
rollback;
