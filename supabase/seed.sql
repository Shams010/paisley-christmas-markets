-- Sample data (all fictional and generated).

-- Markets
insert into public.markets (
  id, slug, name, tagline, description, location_name, location_postcode, latitude, longitude,
  start_date, end_date, contact_email, primary_colour, secondary_colour, accent_colour
) values
(
  '7d1f0b9e-3c1a-4c55-9b0a-5f6f0c1e2a01', 'paisley',
  'Paisley Christmas Markets',
  'Four festive weekends in the heart of Paisley',
  'Forty chalets and gazebos of local makers, food and drink in County Square, with live music from local choirs and bands.',
  'County Square, Paisley', 'PA1 1BN', 55.846600, -4.423900,
  '2026-11-28', '2026-12-20', 'hello@paisleychristmasmarkets.example',
  '#7a1f2b', '#1f4d3a', '#d9a441'
),
(
  'c2f4e8a6-5b7d-4e19-8a3c-9d0e1f2a3b02', 'clyde-coast-food-festival',
  'Clyde Coast Food Festival',
  'A summer weekend of street food and local produce',
  'Street food, bakers and drinks producers from across the west of Scotland, on the seafront.',
  'Seafront Promenade', 'KA30 8BG', 55.794800, -4.870300,
  '2027-07-17', '2027-07-18', 'hello@clydecoastfoodfestival.example',
  '#0b5c7a', '#f2b632', '#e4572e'
)
on conflict (id) do nothing;

-- Categories
insert into public.market_categories (market_id, code, label, requires_food_registration, sort_order) values
  ('7d1f0b9e-3c1a-4c55-9b0a-5f6f0c1e2a01', 'food_drink',           'Food & drink',           true,  1),
  ('7d1f0b9e-3c1a-4c55-9b0a-5f6f0c1e2a01', 'crafts_gifts',         'Crafts & gifts',         false, 2),
  ('7d1f0b9e-3c1a-4c55-9b0a-5f6f0c1e2a01', 'clothing_accessories', 'Clothing & accessories', false, 3),
  ('7d1f0b9e-3c1a-4c55-9b0a-5f6f0c1e2a01', 'decorations',          'Decorations',            false, 4),
  ('7d1f0b9e-3c1a-4c55-9b0a-5f6f0c1e2a01', 'other',                'Other',                  false, 5),
  ('c2f4e8a6-5b7d-4e19-8a3c-9d0e1f2a3b02', 'street_food',          'Street food',            true,  1),
  ('c2f4e8a6-5b7d-4e19-8a3c-9d0e1f2a3b02', 'bakery',               'Bakery & sweets',        true,  2),
  ('c2f4e8a6-5b7d-4e19-8a3c-9d0e1f2a3b02', 'drinks',               'Drinks',                 true,  3),
  ('c2f4e8a6-5b7d-4e19-8a3c-9d0e1f2a3b02', 'local_produce',        'Local produce',          true,  4),
  ('c2f4e8a6-5b7d-4e19-8a3c-9d0e1f2a3b02', 'kitchenware',          'Kitchenware & gifts',    false, 5)
on conflict (market_id, code) do nothing;

-- Stall types
insert into public.market_stall_types (market_id, code, label, fee_per_day_pence, sort_order) values
  ('7d1f0b9e-3c1a-4c55-9b0a-5f6f0c1e2a01', 'gazebo_3x3',    'Gazebo 3×3 m',   4500, 1),
  ('7d1f0b9e-3c1a-4c55-9b0a-5f6f0c1e2a01', 'wooden_chalet', 'Wooden chalet',  8500, 2),
  ('7d1f0b9e-3c1a-4c55-9b0a-5f6f0c1e2a01', 'food_van',      'Food van',      12000, 3),
  ('c2f4e8a6-5b7d-4e19-8a3c-9d0e1f2a3b02', 'gazebo_3x3',    'Gazebo 3×3 m',   6000, 1),
  ('c2f4e8a6-5b7d-4e19-8a3c-9d0e1f2a3b02', 'food_van',      'Food van',      14000, 2),
  ('c2f4e8a6-5b7d-4e19-8a3c-9d0e1f2a3b02', 'market_table',  'Market table',   3000, 3)
on conflict (market_id, code) do nothing;

-- Market days: the four weekends before Christmas 2026
insert into public.market_days (market_id, day, opens_at, closes_at) values
  ('7d1f0b9e-3c1a-4c55-9b0a-5f6f0c1e2a01', '2026-11-28', '10:00', '20:00'),
  ('7d1f0b9e-3c1a-4c55-9b0a-5f6f0c1e2a01', '2026-11-29', '11:00', '18:00'),
  ('7d1f0b9e-3c1a-4c55-9b0a-5f6f0c1e2a01', '2026-12-05', '10:00', '20:00'),
  ('7d1f0b9e-3c1a-4c55-9b0a-5f6f0c1e2a01', '2026-12-06', '11:00', '18:00'),
  ('7d1f0b9e-3c1a-4c55-9b0a-5f6f0c1e2a01', '2026-12-12', '10:00', '20:00'),
  ('7d1f0b9e-3c1a-4c55-9b0a-5f6f0c1e2a01', '2026-12-13', '11:00', '18:00'),
  ('7d1f0b9e-3c1a-4c55-9b0a-5f6f0c1e2a01', '2026-12-19', '10:00', '20:00'),
  ('7d1f0b9e-3c1a-4c55-9b0a-5f6f0c1e2a01', '2026-12-20', '11:00', '18:00'),
  ('c2f4e8a6-5b7d-4e19-8a3c-9d0e1f2a3b02', '2027-07-17', '10:00', '19:00'),
  ('c2f4e8a6-5b7d-4e19-8a3c-9d0e1f2a3b02', '2027-07-18', '10:00', '17:00')
on conflict (market_id, day) do nothing;

-- Paisley has 40 stalls in rows A-D: A and B are chalets, C gazebos 
insert into public.stalls (market_id, code, stall_type, has_power, map_x, map_y)
select '7d1f0b9e-3c1a-4c55-9b0a-5f6f0c1e2a01'::uuid, 'A' || n, 'wooden_chalet', true, 5 + (n - 1) * 10, 15
from generate_series(1, 10) as n
union all
select '7d1f0b9e-3c1a-4c55-9b0a-5f6f0c1e2a01'::uuid, 'B' || n, 'wooden_chalet', true, 5 + (n - 1) * 10, 38
from generate_series(1, 10) as n
union all
select '7d1f0b9e-3c1a-4c55-9b0a-5f6f0c1e2a01'::uuid, 'C' || n, 'gazebo_3x3', n <= 6, 4 + (n - 1) * 8.3, 62
from generate_series(1, 12) as n
union all
select '7d1f0b9e-3c1a-4c55-9b0a-5f6f0c1e2a01'::uuid, 'D' || n, 'food_van', true, 8 + (n - 1) * 12, 86
from generate_series(1, 8) as n
on conflict (market_id, code) do nothing;

insert into public.stalls (market_id, code, stall_type, has_power, map_x, map_y)
select 'c2f4e8a6-5b7d-4e19-8a3c-9d0e1f2a3b02'::uuid, 'A' || n,
       case when n <= 4 then 'food_van' when n <= 9 then 'gazebo_3x3' else 'market_table' end,
       n <= 6, 6 + (n - 1) * 8, 50
from generate_series(1, 12) as n
on conflict (market_id, code) do nothing;

-- Announcements
insert into public.announcements (market_id, title, body, published_at)
select v.market_id::uuid, v.title, v.body, v.published_at::timestamptz
from (values
  ('7d1f0b9e-3c1a-4c55-9b0a-5f6f0c1e2a01', 'Trader applications are open',
   'Apply online for a chalet, gazebo or food van pitch. We aim to reply to every application within ten working days.',
   '2026-10-01 09:00+00'),
  ('7d1f0b9e-3c1a-4c55-9b0a-5f6f0c1e2a01', 'Opening weekend line-up announced',
   'Local choirs open the market on Saturday 28 November at 12 noon, followed by the lights switch-on at 5pm.',
   '2026-11-02 09:00+00'),
  ('7d1f0b9e-3c1a-4c55-9b0a-5f6f0c1e2a01', 'Getting here',
   'County Square is two minutes'' walk from Paisley Gilmour Street station. Blue badge parking is available on Gilmour Street.',
   '2026-11-09 09:00+00'),
  ('c2f4e8a6-5b7d-4e19-8a3c-9d0e1f2a3b02', 'Save the date',
   'The festival returns to the seafront on 17 and 18 July 2027. Trader applications open in the spring.',
   '2026-11-01 09:00+00')
) as v(market_id, title, body, published_at)
where not exists (
  select 1 from public.announcements a where a.market_id = v.market_id::uuid and a.title = v.title
);
