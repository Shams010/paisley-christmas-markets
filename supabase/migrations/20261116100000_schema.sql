-- Everything carries a market_id so one install can run several, so markets with their data kept apart. Business rules are in _functions, access rules in _security.


create type public.application_status as enum (
  'submitted', 'under_review', 'changes_requested', 'approved', 'rejected', 'withdrawn'
);
create type public.power_requirement as enum ('none', 'one_socket', 'two_plus_sockets', 'high_load');
create type public.consent_purpose   as enum ('privacy_policy', 'marketing');
create type public.enquiry_type      as enum ('general', 'feedback', 'data_protection');
create type public.enquiry_status    as enum ('new', 'acknowledged', 'closed');

-- markets: one row per client. Branding, dates and retention periods are data, so a new client is set up by inserting rows rather than changing code.
create table public.markets (
  id                            uuid primary key default gen_random_uuid(),
  slug                          text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 60),
  name                          text not null check (length(name) between 2 and 120),
  tagline                       text,
  description                   text,
  location_name                 text,
  location_postcode             text,
  latitude                      numeric(9, 6),
  longitude                     numeric(9, 6),
  start_date                    date not null,
  end_date                      date not null,
  contact_email                 text,
  primary_colour                text not null default '#7a1f2b' check (primary_colour ~ '^#[0-9a-fA-F]{6}$'),
  secondary_colour              text not null default '#1f4d3a' check (secondary_colour ~ '^#[0-9a-fA-F]{6}$'),
  accent_colour                 text not null default '#d9a441' check (accent_colour ~ '^#[0-9a-fA-F]{6}$'),
  logo_url                      text,
  applications_open             boolean not null default true,
  privacy_policy_version        text not null default '2026-11',
  marketing_wording             text not null default 'Email me news about future markets run by the organisers.',
  -- Retention periods, in months after the market's end date.
  retention_unsuccessful_months integer not null default 6  check (retention_unsuccessful_months between 1 and 84),
  retention_enquiry_months      integer not null default 12 check (retention_enquiry_months between 1 and 84),
  retention_audit_months        integer not null default 12 check (retention_audit_months between 1 and 84),
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  check (end_date >= start_date)
);


create table public.market_categories (
  market_id                  uuid not null references public.markets (id) on delete cascade,
  code                       text not null check (code ~ '^[a-z0-9_]{2,40}$'),
  label                      text not null,
  requires_food_registration boolean not null default false,
  sort_order                 integer not null default 0,
  primary key (market_id, code)
);

create table public.market_stall_types (
  market_id         uuid not null references public.markets (id) on delete cascade,
  code              text not null check (code ~ '^[a-z0-9_]{2,40}$'),
  label             text not null,
  fee_per_day_pence integer check (fee_per_day_pence >= 0),
  sort_order        integer not null default 0,
  primary key (market_id, code)
);

create table public.market_days (
  id        bigint generated always as identity primary key,
  market_id uuid not null references public.markets (id) on delete cascade,
  day       date not null,
  opens_at  time not null default '10:00',
  closes_at time not null default '20:00',
  unique (market_id, day),
  unique (id, market_id),            
  check (closes_at > opens_at)
);

-- profiles: one row per account, keyed by the Supabase Auth user id. Contact details live here only, so there is one place to correct or erase them.
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  contact_name text check (length(contact_name) between 2 and 80),
  phone        text check (length(phone) between 7 and 20),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- applications: one stall application from one trader to one market.
create table public.applications (
  id                           bigint generated always as identity primary key,
  market_id                    uuid not null references public.markets (id) on delete cascade,
  trader_id                    uuid not null references public.profiles (id) on delete cascade,
  business_name                text not null check (length(business_name) between 2 and 80),
  postcode                     text not null check (length(postcode) between 5 and 8),
  category                     text not null,
  description                  text not null check (length(description) between 20 and 500),
  stall_type                   text not null,
  needs_power                  boolean not null,
  power_requirement            public.power_requirement not null default 'none',
  uses_lpg                     boolean not null default false,
  insurance_expiry             date not null,
  website_url                  text check (website_url ~ '^https://' and length(website_url) <= 200),
  social_link                  text check (social_link ~ '^https://' and length(social_link) <= 200),
  additional_requirements      text check (length(additional_requirements) <= 300),
  -- Paths into Supabase Storage, not the files themselves.
  food_registration_path       text,
  gas_safety_certificate_path  text,
  logo_path                    text,
  is_over_18                   boolean not null check (is_over_18),
  accept_privacy_policy        boolean not null check (accept_privacy_policy),
  status                       public.application_status not null default 'submitted',
  admin_note                   text check (length(admin_note) <= 1000),
  submitted_at                 timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  decided_at                   timestamptz,
  unique (id, market_id),
  foreign key (market_id, category)   references public.market_categories (market_id, code),
  foreign key (market_id, stall_type) references public.market_stall_types (market_id, code),
  constraint power_fields_agree check (needs_power = (power_requirement <> 'none')),
  constraint lpg_needs_certificate check (not uses_lpg or gas_safety_certificate_path is not null)
);

-- One live application per trader per market. Withdrawn and rejected ones are excluded so the trader can apply again.
create unique index applications_one_live_per_trader
  on public.applications (market_id, trader_id)
  where status not in ('withdrawn', 'rejected');

create index applications_market_status_idx on public.applications (market_id, status);
create index applications_trader_idx        on public.applications (trader_id);

-- Days each application is for. The composite foreign keys stop an application being linked to a day from a different market.
create table public.application_days (
  application_id bigint not null,
  market_day_id  bigint not null,
  market_id      uuid   not null,
  primary key (application_id, market_day_id),
  foreign key (application_id, market_id) references public.applications (id, market_id) on delete cascade,
  foreign key (market_day_id, market_id)  references public.market_days (id, market_id) on delete cascade
);
create index application_days_day_idx on public.application_days (market_day_id);

create table public.stalls (
  id         bigint generated always as identity primary key,
  market_id  uuid not null references public.markets (id) on delete cascade,
  code       text not null check (code ~ '^[A-Z][0-9]{1,3}$'),
  stall_type text not null,
  has_power  boolean not null default false,
  map_x      numeric(5, 2) not null check (map_x between 0 and 100),   -- stall map position, in %
  map_y      numeric(5, 2) not null check (map_y between 0 and 100),
  unique (market_id, code),
  unique (id, market_id),
  foreign key (market_id, stall_type) references public.market_stall_types (market_id, code)
);

create table public.stall_allocations (
  id             bigint generated always as identity primary key,
  market_id      uuid   not null,
  application_id bigint not null,
  stall_id       bigint not null,
  market_day_id  bigint not null,
  created_at     timestamptz not null default now(),
  unique (stall_id, market_day_id),         -- a stall holds one trader per day
  unique (application_id, market_day_id),   -- a trader has one stall per day
  foreign key (application_id, market_id) references public.applications (id, market_id) on delete cascade,
  foreign key (stall_id, market_id)       references public.stalls (id, market_id) on delete cascade,
  foreign key (market_day_id, market_id)  references public.market_days (id, market_id) on delete cascade
);
create index stall_allocations_market_idx on public.stall_allocations (market_id);


create table public.consents (
  id              bigint generated always as identity primary key,
  market_id       uuid not null references public.markets (id) on delete cascade,
  trader_id       uuid not null references public.profiles (id) on delete cascade,
  purpose         public.consent_purpose not null,
  granted         boolean not null,
  wording         text not null,
  wording_version text not null,
  created_at      timestamptz not null default now()
);
create index consents_trader_idx on public.consents (trader_id, market_id, purpose, created_at desc);

-- audit_log holds ids and status codes only, no personal details. actor_id has no foreign key on purpose so the history survives an account being deleted.
create table public.audit_log (
  id         bigint generated always as identity primary key,
  market_id  uuid not null references public.markets (id) on delete cascade,
  actor_id   uuid,
  action     text not null,
  entity     text not null,
  entity_id  bigint,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_market_idx on public.audit_log (market_id, created_at desc);

-- announcements: news shown on the public site, maintained by administrators.
create table public.announcements (
  id           bigint generated always as identity primary key,
  market_id    uuid not null references public.markets (id) on delete cascade,
  title        text not null check (length(title) between 3 and 120),
  body         text not null check (length(body) between 3 and 2000),
  published    boolean not null default true,
  published_at timestamptz not null default now(),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index announcements_market_idx on public.announcements (market_id, published_at desc);

create table public.enquiries (
  id              bigint generated always as identity primary key,
  market_id       uuid not null references public.markets (id) on delete cascade,
  type            public.enquiry_type not null default 'general',
  name            text check (length(name) <= 80),
  email           text check (length(email) <= 254),
  message         text not null check (length(message) between 10 and 2000),
  status          public.enquiry_status not null default 'new',
  created_at      timestamptz not null default now(),
  acknowledged_at timestamptz
);
create index enquiries_market_idx on public.enquiries (market_id, type, status, created_at desc);

create table public.market_statistics (
  id          bigint generated always as identity primary key,
  market_id   uuid not null references public.markets (id) on delete cascade,
  recorded_on date not null default current_date,
  category    text not null,
  status      public.application_status not null,
  total       integer not null check (total >= 0),
  unique (market_id, recorded_on, category, status)
);
