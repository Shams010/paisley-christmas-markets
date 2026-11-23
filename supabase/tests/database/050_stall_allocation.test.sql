-- Stall allocation and the public stall map.
begin;
select * from no_plan();
select tests.create_cast();

select tests.login('aisha@traders.example');
select public.submit_application('paisley', tests.application());                      -- days: 5 and 6 December
select tests.login('ben@traders.example');
select public.submit_application('paisley', tests.application('{"business_name":"Ben''s Baubles","category":"decorations"}'));
select tests.logout();

select tests.login('admin@paisley.example');
select throws_ok(
  format($$ insert into public.stall_allocations (market_id, application_id, stall_id, market_day_id) values (%L, %s, %s, %s) $$,
    tests.market_id('paisley'), tests.app_id('Gleniffer Candle Co.'), tests.stall_id('paisley', 'C1'), tests.day_id('paisley', '2026-12-05')),
  'P0001', 'application_not_approved', 'a stall cannot be given to an application that is not approved');
select tests.logout();

select tests.decide('Gleniffer Candle Co.', 'approved');
select tests.decide('Ben''s Baubles', 'approved');

select tests.login('admin@paisley.example');
select lives_ok(
  format($$ insert into public.stall_allocations (market_id, application_id, stall_id, market_day_id) values (%L, %s, %s, %s) $$,
    tests.market_id('paisley'), tests.app_id('Gleniffer Candle Co.'), tests.stall_id('paisley', 'C1'), tests.day_id('paisley', '2026-12-05')),
  'an administrator can allocate a stall to an approved trader');
select throws_ok(
  format($$ insert into public.stall_allocations (market_id, application_id, stall_id, market_day_id) values (%L, %s, %s, %s) $$,
    tests.market_id('paisley'), tests.app_id('Ben''s Baubles'), tests.stall_id('paisley', 'C1'), tests.day_id('paisley', '2026-12-05')),
  '23505', null, 'the same stall cannot be given to two traders on one day');
select throws_ok(
  format($$ insert into public.stall_allocations (market_id, application_id, stall_id, market_day_id) values (%L, %s, %s, %s) $$,
    tests.market_id('paisley'), tests.app_id('Gleniffer Candle Co.'), tests.stall_id('paisley', 'C2'), tests.day_id('paisley', '2026-12-05')),
  '23505', null, 'a trader cannot hold two stalls on one day');
select throws_ok(
  format($$ insert into public.stall_allocations (market_id, application_id, stall_id, market_day_id) values (%L, %s, %s, %s) $$,
    tests.market_id('paisley'), tests.app_id('Gleniffer Candle Co.'), tests.stall_id('paisley', 'C1'), tests.day_id('paisley', '2026-12-19')),
  'P0001', 'day_not_requested', 'a stall cannot be allocated on a day the trader did not apply for');
select throws_ok(
  format($$ insert into public.stall_allocations (market_id, application_id, stall_id, market_day_id) values (%L, %s, %s, %s) $$,
    tests.market_id('paisley'), tests.app_id('Ben''s Baubles'), tests.stall_id('clyde-coast-food-festival', 'A1'), tests.day_id('paisley', '2026-12-05')),
  '23503', null, 'a stall from another market cannot be used');

select tests.login('admin@clyde.example');
select throws_ok(
  format($$ insert into public.stall_allocations (market_id, application_id, stall_id, market_day_id) values (%L, %s, %s, %s) $$,
    tests.market_id('paisley'), tests.app_id('Ben''s Baubles'), tests.stall_id('paisley', 'C3'), tests.day_id('paisley', '2026-12-05')),
  'P0001', 'application_not_approved', 'an administrator of another market cannot allocate stalls here (they cannot even see the application)');
select is_empty($$ delete from public.stall_allocations returning 1 $$, 'or remove allocations');

select tests.login('aisha@traders.example');
select is((select allocations -> 0 ->> 'stall' from public.application_details), 'C1', 'the trader sees their stall');
select throws_ok(
  format($$ insert into public.stall_allocations (market_id, application_id, stall_id, market_day_id) values (%L, %s, %s, %s) $$,
    tests.market_id('paisley'), tests.app_id('Gleniffer Candle Co.'), tests.stall_id('paisley', 'A1'), tests.day_id('paisley', '2026-12-06')),
  '42501', null, 'but cannot allocate one to themselves');
select tests.login('ben@traders.example');
select is((select count(*)::int from public.stall_allocations), 0, 'another trader cannot see the allocation table rows');

select tests.as_anon();
select is(
  (select trader_name from public.public_stall_map
   where market_id = tests.market_id('paisley') and code = 'C1' and day = '2026-12-05'),
  'Gleniffer Candle Co.', 'the public stall map shows the trader on their stall');
select is(
  (select count(*)::int from public.public_stall_map
   where market_id = tests.market_id('paisley') and day = '2026-12-05' and trader_name is null),
  39, 'and the other 39 stalls as free');
select is(
  (select stalls from public.public_traders where business_name = 'Gleniffer Candle Co.'),
  '[{"date":"2026-12-05","stall":"C1"}]'::jsonb, 'the directory listing includes the stall number');

select tests.login('admin@paisley.example');
select is(
  (select (public.admin_stats(tests.market_id('paisley')) -> 'by_status' ->> 'approved')::int), 2,
  'the admin dashboard counts approved applications');
select is(
  (select (d ->> 'stalls_allocated')::int
   from jsonb_array_elements(public.admin_stats(tests.market_id('paisley')) -> 'by_day') d where d ->> 'date' = '2026-12-05'),
  1, 'and stalls allocated per day');
select isnt_empty($$ delete from public.stall_allocations returning 1 $$, 'an administrator can remove an allocation');
select tests.logout();

select is(
  (select array_agg(l.action order by l.id) from public.audit_log l where l.action like 'stall_%'),
  array['stall_allocated', 'stall_unallocated'], 'allocations are written to the audit log');

select * from finish();
rollback;
