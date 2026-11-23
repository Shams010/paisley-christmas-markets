-- Grants decide which tables a role can use, then RLS decides which rows.


create view public.public_traders as
select
  a.id,
  a.market_id,
  a.business_name,
  a.category,
  c.label as category_label,
  a.description,
  a.website_url,
  a.social_link,
  a.logo_path,
  coalesce((
    select jsonb_agg(jsonb_build_object('date', d.day, 'stall', s.code) order by d.day)
    from public.stall_allocations sa
    join public.market_days d on d.id = sa.market_day_id
    join public.stalls s on s.id = sa.stall_id
    where sa.application_id = a.id
  ), '[]'::jsonb) as stalls
from public.applications a
join public.market_categories c on c.market_id = a.market_id and c.code = a.category
where a.status = 'approved';

-- One row per stall per market day, with the approved trader if there is one.
create view public.public_stall_map as
select
  s.id        as stall_id,
  s.market_id,
  s.code,
  s.stall_type,
  t.label     as stall_type_label,
  s.has_power,
  s.map_x,
  s.map_y,
  d.id        as market_day_id,
  d.day,
  a.id            as trader_id,
  a.business_name as trader_name,
  a.category      as trader_category
from public.stalls s
join public.market_days d on d.market_id = s.market_id
join public.market_stall_types t on t.market_id = s.market_id and t.code = s.stall_type
left join public.stall_allocations sa on sa.stall_id = s.id and sa.market_day_id = d.id
left join public.applications a on a.id = sa.application_id and a.status = 'approved';

-- security_invoker so the view follows the RLS on the tables underneath
create view public.application_details
with (security_invoker = true) as
select
  a.id,
  a.market_id,
  m.slug as market_slug,
  a.trader_id,
  p.contact_name,
  p.phone,
  a.business_name,
  a.postcode,
  a.category,
  c.label as category_label,
  a.description,
  a.stall_type,
  t.label as stall_type_label,
  a.needs_power,
  a.power_requirement,
  a.uses_lpg,
  a.insurance_expiry,
  a.website_url,
  a.social_link,
  a.additional_requirements,
  a.food_registration_path,
  a.gas_safety_certificate_path,
  a.logo_path,
  a.is_over_18,
  a.accept_privacy_policy,
  a.status,
  a.admin_note,
  a.submitted_at,
  a.updated_at,
  a.decided_at,
  coalesce((
    select jsonb_agg(d.day order by d.day)
    from public.application_days ad
    join public.market_days d on d.id = ad.market_day_id
    where ad.application_id = a.id
  ), '[]'::jsonb) as market_days,
  coalesce((
    select jsonb_agg(jsonb_build_object('id', sa.id, 'date', d.day, 'market_day_id', d.id,
                                        'stall_id', s.id, 'stall', s.code) order by d.day)
    from public.stall_allocations sa
    join public.market_days d on d.id = sa.market_day_id
    join public.stalls s on s.id = sa.stall_id
    where sa.application_id = a.id
  ), '[]'::jsonb) as allocations
from public.applications a
join public.markets m on m.id = a.market_id
join public.market_categories c on c.market_id = a.market_id and c.code = a.category
join public.market_stall_types t on t.market_id = a.market_id and t.code = a.stall_type
left join public.profiles p on p.id = a.trader_id;

-- Grants: revoke everything first, then add back only what each role needs.
revoke all on
  public.markets, public.market_categories, public.market_stall_types, public.market_days,
  public.profiles, public.applications, public.application_days, public.stalls,
  public.stall_allocations, public.consents, public.audit_log, public.announcements,
  public.enquiries, public.market_statistics,
  public.public_traders, public.public_stall_map, public.application_details
from public, anon, authenticated, service_role;

-- Public, non-personal information
grant select on
  public.markets, public.market_categories, public.market_stall_types, public.market_days,
  public.stalls, public.announcements, public.public_traders, public.public_stall_map
to anon, authenticated;

-- Logged-in users. The RLS policies below narrow these down to the right rows.
grant select, insert, update on public.profiles          to authenticated;
grant select, insert, update on public.applications      to authenticated;
grant select, insert, delete on public.application_days  to authenticated;
grant select, insert, delete on public.stall_allocations to authenticated;
grant select, insert         on public.consents          to authenticated;
grant select                 on public.audit_log         to authenticated;
grant select, update         on public.enquiries         to authenticated;
grant select                 on public.market_statistics to authenticated;
grant select                 on public.application_details to authenticated;
grant insert, update, delete on public.announcements     to authenticated;

-- Administrators may update their market's public details, but only these columns. 
grant update (name, tagline, description, location_name, location_postcode, contact_email,
              primary_colour, secondary_colour, accent_colour, logo_url, applications_open)
  on public.markets to authenticated;

-- The API server's secret key.
grant select, insert, update, delete on
  public.markets, public.market_categories, public.market_stall_types, public.market_days,
  public.profiles, public.applications, public.application_days, public.stalls,
  public.stall_allocations, public.consents, public.audit_log, public.announcements,
  public.enquiries, public.market_statistics
to service_role;
grant select on public.public_traders, public.public_stall_map, public.application_details to service_role;

-- Postgres lets everyone execute a new function by default.
revoke execute on all functions in schema public      from public, anon, authenticated, service_role;
revoke execute on all functions in schema app_private from public, anon, authenticated, service_role;

grant usage on schema app_private to authenticated, service_role;
grant execute on all functions in schema app_private to authenticated, service_role;

grant execute on function public.is_market_admin(uuid)                    to anon, authenticated, service_role;
grant execute on function public.submit_application(text, jsonb)          to authenticated;
grant execute on function public.update_application(bigint, jsonb)        to authenticated;
grant execute on function public.set_marketing_consent(text, boolean)     to authenticated;
grant execute on function public.admin_get_trader_email(bigint)           to authenticated;
grant execute on function public.admin_stats(uuid)                        to authenticated;
grant execute on function public.submit_enquiry(text, public.enquiry_type, text, text, text)
                                                                          to anon, authenticated;
grant execute on function public.purge_expired_data()                     to service_role;
grant execute on function public.orphaned_uploads(interval)               to service_role;

-- RLS on every table. With RLS on and no matching policy, a role just gets no rows.
alter table public.markets            enable row level security;
alter table public.market_categories  enable row level security;
alter table public.market_stall_types enable row level security;
alter table public.market_days        enable row level security;
alter table public.profiles           enable row level security;
alter table public.applications       enable row level security;
alter table public.application_days   enable row level security;
alter table public.stalls             enable row level security;
alter table public.stall_allocations  enable row level security;
alter table public.consents           enable row level security;
alter table public.audit_log          enable row level security;
alter table public.announcements      enable row level security;
alter table public.enquiries          enable row level security;
alter table public.market_statistics  enable row level security;

-- Public information
create policy "Anyone can read markets"
  on public.markets for select to anon, authenticated using (true);

create policy "Admins update their own market"
  on public.markets for update to authenticated
  using (public.is_market_admin(id)) with check (public.is_market_admin(id));

create policy "Anyone can read categories"
  on public.market_categories for select to anon, authenticated using (true);

create policy "Anyone can read stall types"
  on public.market_stall_types for select to anon, authenticated using (true);

create policy "Anyone can read market days"
  on public.market_days for select to anon, authenticated using (true);

create policy "Anyone can read stalls"
  on public.stalls for select to anon, authenticated using (true);

create policy "Anyone can read published announcements"
  on public.announcements for select to anon, authenticated
  using (published or public.is_market_admin(market_id));

create policy "Admins add announcements"
  on public.announcements for insert to authenticated
  with check (public.is_market_admin(market_id));

create policy "Admins edit announcements"
  on public.announcements for update to authenticated
  using (public.is_market_admin(market_id)) with check (public.is_market_admin(market_id));

create policy "Admins delete announcements"
  on public.announcements for delete to authenticated
  using (public.is_market_admin(market_id));

-- Profiles
create policy "Users read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "Admins read profiles of traders who applied to their market"
  on public.profiles for select to authenticated
  using (exists (
    select 1 from public.applications a
    where a.trader_id = profiles.id and public.is_market_admin(a.market_id)
  ));

create policy "Users create their own profile"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);

create policy "Users update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Applications
create policy "Traders read their own applications"
  on public.applications for select to authenticated
  using ((select auth.uid()) = trader_id);

create policy "Admins read applications for their market"
  on public.applications for select to authenticated
  using (public.is_market_admin(market_id));

create policy "Traders create their own applications"
  on public.applications for insert to authenticated
  with check ((select auth.uid()) = trader_id);

create policy "Traders update their own applications"
  on public.applications for update to authenticated
  using ((select auth.uid()) = trader_id) with check ((select auth.uid()) = trader_id);

create policy "Admins update applications for their market"
  on public.applications for update to authenticated
  using (public.is_market_admin(market_id)) with check (public.is_market_admin(market_id));
-- No delete policy: applications are only removed server-side (account deletion,
-- retention job), which uses the secret key.

-- Application days

create policy "Days are visible with their application"
  on public.application_days for select to authenticated
  using (exists (select 1 from public.applications a where a.id = application_id));

create policy "Traders set days on their open applications"
  on public.application_days for insert to authenticated
  with check (exists (
    select 1 from public.applications a
    where a.id = application_id
      and a.trader_id = (select auth.uid())
      and a.status in ('submitted', 'changes_requested')
  ));

create policy "Traders remove days from their open applications"
  on public.application_days for delete to authenticated
  using (exists (
    select 1 from public.applications a
    where a.id = application_id
      and a.trader_id = (select auth.uid())
      and a.status in ('submitted', 'changes_requested')
  ));

-- Stall allocations
create policy "Traders see their own stall, admins see their market"
  on public.stall_allocations for select to authenticated
  using (
    public.is_market_admin(market_id)
    or exists (select 1 from public.applications a
               where a.id = application_id and a.trader_id = (select auth.uid()))
  );

create policy "Admins allocate stalls"
  on public.stall_allocations for insert to authenticated
  with check (public.is_market_admin(market_id));

create policy "Admins remove allocations"
  on public.stall_allocations for delete to authenticated
  using (public.is_market_admin(market_id));

-- Consents. No update or delete policy, so the history is append-only.
create policy "Traders read their own consent history"
  on public.consents for select to authenticated
  using ((select auth.uid()) = trader_id);

create policy "Traders record their own consent"
  on public.consents for insert to authenticated
  with check ((select auth.uid()) = trader_id);

-- Admin-only tables
create policy "Admins read their market's audit log"
  on public.audit_log for select to authenticated
  using (public.is_market_admin(market_id));

create policy "Admins read their market's enquiries"
  on public.enquiries for select to authenticated
  using (public.is_market_admin(market_id));

create policy "Admins update their market's enquiries"
  on public.enquiries for update to authenticated
  using (public.is_market_admin(market_id)) with check (public.is_market_admin(market_id));

create policy "Admins read their market's statistics"
  on public.market_statistics for select to authenticated
  using (public.is_market_admin(market_id));
