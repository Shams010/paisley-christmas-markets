-- Structure and access control are in place.
begin;
select * from no_plan();

-- Every table in public has Row Level Security switched on.
select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0,
  'every public table has RLS enabled'
);

select has_table('public', t, 'table ' || t || ' exists')
from unnest(array[
  'markets', 'market_categories', 'market_stall_types', 'market_days', 'profiles', 'applications',
  'application_days', 'stalls', 'stall_allocations', 'consents', 'audit_log', 'announcements',
  'enquiries', 'market_statistics'
]) as t;

-- Every table carries a market_id except profiles (an account can apply to several markets).
select is(
  (select array_agg(c.table_name::text order by c.table_name)
   from information_schema.tables c
   where c.table_schema = 'public' and c.table_type = 'BASE TABLE'
     and not exists (select 1 from information_schema.columns k
                     where k.table_schema = 'public' and k.table_name = c.table_name
                       and k.column_name in ('market_id', 'id') and k.udt_name = 'uuid'
                       and (k.column_name = 'market_id' or c.table_name = 'markets'))),
  array['profiles'],
  'all tables are scoped to a market (profiles is per account)'
);

-- Visitors (anon)
select ok(has_table_privilege('anon', 'public.markets', 'select'),            'anon can read markets');
select ok(has_table_privilege('anon', 'public.public_traders', 'select'),     'anon can read the public traders view');
select ok(has_table_privilege('anon', 'public.public_stall_map', 'select'),   'anon can read the stall map view');
select ok(not has_table_privilege('anon', 'public.applications', 'select'),   'anon has no access to applications');
select ok(not has_table_privilege('anon', 'public.profiles', 'select'),       'anon has no access to profiles');
select ok(not has_table_privilege('anon', 'public.consents', 'select'),       'anon has no access to consents');
select ok(not has_table_privilege('anon', 'public.enquiries', 'select'),      'anon cannot read enquiries');
select ok(not has_table_privilege('anon', 'public.enquiries', 'insert'),      'anon cannot insert enquiries directly');
select ok(not has_table_privilege('anon', 'public.audit_log', 'select'),      'anon has no access to the audit log');
select ok(not has_table_privilege('anon', 'public.application_details', 'select'), 'anon cannot read application details');
select ok(not has_table_privilege('anon', 'public.markets', 'update'),        'anon cannot change markets');

-- Logged-in users
select ok(not has_table_privilege('authenticated', 'public.applications', 'delete'), 'users cannot delete applications');
select ok(not has_table_privilege('authenticated', 'public.audit_log', 'insert'),    'users cannot write to the audit log');
select ok(not has_table_privilege('authenticated', 'public.audit_log', 'update'),    'users cannot edit the audit log');
select ok(not has_table_privilege('authenticated', 'public.audit_log', 'delete'),    'users cannot delete from the audit log');
select ok(not has_table_privilege('authenticated', 'public.consents', 'update'),     'consent records cannot be edited');
select ok(not has_table_privilege('authenticated', 'public.consents', 'delete'),     'consent records cannot be deleted');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'delete'),     'users cannot delete profiles directly');
select ok(not has_column_privilege('authenticated', 'public.markets', 'slug', 'update'),
          'admins cannot change a market''s slug from the app');
select ok(not has_column_privilege('authenticated', 'public.markets', 'retention_unsuccessful_months', 'update'),
          'admins cannot change retention periods from the app');
select ok(has_column_privilege('authenticated', 'public.markets', 'applications_open', 'update'),
          'admins can open and close applications');

-- Functions
select ok(not has_function_privilege('anon', 'public.submit_application(text, jsonb)', 'execute'),
          'anon cannot submit applications');
select ok(has_function_privilege('authenticated', 'public.submit_application(text, jsonb)', 'execute'),
          'logged-in users can submit applications');
select ok(has_function_privilege('anon', 'public.submit_enquiry(text, public.enquiry_type, text, text, text)', 'execute'),
          'anon can use the contact form');
select ok(not has_function_privilege('authenticated', 'public.purge_expired_data()', 'execute'),
          'users cannot run the retention job');
select ok(not has_function_privilege('anon', 'public.purge_expired_data()', 'execute'),
          'anon cannot run the retention job');
select ok(has_function_privilege('service_role', 'public.purge_expired_data()', 'execute'),
          'the server can run the retention job');
select ok(not has_function_privilege('authenticated', 'public.orphaned_uploads(interval)', 'execute'),
          'users cannot list other people''s uploads');
select ok(not has_schema_privilege('anon', 'app_private', 'usage'),
          'anon cannot reach the private helper schema');

-- Storage
select is((select public from storage.buckets where id = 'trader-documents'), false, 'documents bucket is private');
select is((select public from storage.buckets where id = 'trader-logos'), true, 'logos bucket is public');
select is((select file_size_limit from storage.buckets where id = 'trader-documents'), 5242880::bigint,
          'documents are limited to 5 MB');
select ok((select allowed_mime_types @> array['application/pdf'] and not allowed_mime_types @> array['text/html']
           from storage.buckets where id = 'trader-documents'), 'documents bucket only accepts PDFs and images');

-- Seed data
select is((select count(*)::int from public.markets), 2, 'two demo markets are seeded');
select is((select count(*)::int from public.stalls s join public.markets m on m.id = s.market_id where m.slug = 'paisley'),
          40, 'Paisley has 40 stalls');
select is((select count(*)::int from public.market_days d join public.markets m on m.id = d.market_id where m.slug = 'paisley'),
          8, 'Paisley has 8 market days');

select * from finish();
rollback;
