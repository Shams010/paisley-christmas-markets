// Adds admin@demo.example and trader1..8@demo.example to Paisley, covering every status, all using DEMO_PASSWORD.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../src/config.js';
import { serviceClient } from '../src/supabase.js';

const password = process.env.DEMO_PASSWORD;
if (!password || password.length < 8) {
  console.error('Set DEMO_PASSWORD (at least 8 characters) in .env or on the command line.');
  process.exit(1);
}

const service = serviceClient();
const stateless = { auth: { persistSession: false, autoRefreshToken: false } };
const SLUG = 'paisley';

const market = (await service.from('markets').select('id').eq('slug', SLUG).limit(1)).data?.[0] as { id: string } | undefined;
if (!market) {
  console.error('Paisley market not found. Run supabase/seed.sql first.');
  process.exit(1);
}

async function login(email: string, appMetadata?: Record<string, unknown>): Promise<{ db: SupabaseClient; id: string; isNew: boolean }> {
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: appMetadata });
  const session = await createClient(config.supabaseUrl, config.publishableKey, stateless).auth.signInWithPassword({ email, password: password! });
  if (session.error || !session.data.session) throw new Error(`Cannot log in as ${email}: ${session.error?.message}`);
  const db = createClient(config.supabaseUrl, config.publishableKey, {
    ...stateless,
    global: { headers: { Authorization: `Bearer ${session.data.session.access_token}` } },
  });
  return { db, id: session.data.session.user.id, isNew: !created.error };
}

const base = {
  phone: '07700 900100', postcode: 'PA1 1BN', needs_power: false, power_requirement: 'none',
  insurance_expiry: '2027-06-30', is_over_18: true, accept_privacy_policy: true, marketing_opt_in: false,
};
const weekend2 = ['2026-12-05', '2026-12-06'];

const traders = [
  { name: 'Gleniffer Candle Co.', contact: 'Aisha Rahman', category: 'crafts_gifts', stall_type: 'gazebo_3x3', days: weekend2, outcome: 'approved', stall: 'C1',
    description: 'Hand-poured soy candles and wax melts in winter scents, made in small batches in Paisley.' },
  { name: 'Seedhill Street Food', contact: 'Ben Carter', category: 'food_drink', stall_type: 'food_van', days: weekend2, outcome: 'approved', stall: 'D1', lpg: true,
    description: 'Loaded flatbreads, haggis bon bons and hot chocolate served from a converted horse box.' },
  { name: 'Thread & Thistle Knitwear', contact: 'Morag Sinclair', category: 'clothing_accessories', stall_type: 'wooden_chalet', days: weekend2, outcome: 'approved', stall: 'A3',
    description: 'Lambswool scarves, hats and mittens knitted in Renfrewshire using Paisley-pattern colourways.' },
  { name: 'Abbey Bauble Works', contact: 'Daniel Okafor', category: 'decorations', stall_type: 'wooden_chalet', days: weekend2, outcome: 'approved', stall: 'A4',
    description: 'Hand-painted glass baubles and wooden tree decorations, personalised while you wait.' },
  { name: 'White Cart Bakes', contact: 'Priya Nair', category: 'food_drink', stall_type: 'gazebo_3x3', days: ['2026-12-12', '2026-12-13'], outcome: 'under_review',
    description: 'Tray bakes, shortbread and mince pies baked fresh each morning, with vegan options.' },
  { name: 'Paisley Pattern Prints', contact: 'Tom Gallacher', category: 'crafts_gifts', stall_type: 'wooden_chalet', days: ['2026-12-19', '2026-12-20'], outcome: 'submitted',
    description: 'Screen-printed cards, tea towels and tote bags inspired by the town\'s textile archive.' },
  { name: 'Cart Valley Fudge', contact: 'Eilidh Fraser', category: 'food_drink', stall_type: 'wooden_chalet', days: weekend2, outcome: 'changes_requested', note: 'Please upload a current food business registration; the one provided has expired.',
    description: 'Butter fudge and tablet in twelve flavours, cut and boxed at the stall.' },
  { name: 'Oakshaw Woodturning', contact: 'Callum Reid', category: 'crafts_gifts', stall_type: 'gazebo_3x3', days: ['2026-11-28'], outcome: 'rejected', note: 'The crafts and gifts category is full for the opening weekend.',
    description: 'Turned bowls, pens and chopping boards made from locally felled hardwood.' },
] as const;

const admin = await login('admin@demo.example', { role: 'admin', market_id: market.id });
const pdf = Buffer.from('%PDF-1.4\n% Demo document for the proof of concept. Not a real certificate.\n');

for (const [index, t] of traders.entries()) {
  const email = `trader${index + 1}@demo.example`;
  const user = await login(email);
  const existing = await user.db.from('applications').select('id').eq('trader_id', user.id).limit(1);
  if (existing.data?.[0]) {
    console.log(`skip   ${email} (already has an application)`);
    continue;
  }

  const form: Record<string, unknown> = {
    ...base, business_name: t.name, contact_name: t.contact, category: t.category, stall_type: t.stall_type,
    description: t.description, market_days: t.days,
  };
  if (t.category === 'food_drink') {
    const path = `${user.id}/food-registration.pdf`;
    await user.db.storage.from('trader-documents').upload(path, pdf, { contentType: 'application/pdf', upsert: false });
    form.food_registration = path;
    form.needs_power = true;
    form.power_requirement = 'one_socket';
    if ('lpg' in t && t.lpg) {
      const gas = `${user.id}/gas-safety.pdf`;
      await user.db.storage.from('trader-documents').upload(gas, pdf, { contentType: 'application/pdf' });
      form.uses_lpg = true;
      form.gas_safety_certificate = gas;
    }
  }

  const submitted = await user.db.rpc('submit_application', { p_market_slug: SLUG, p_application: form });
  if (submitted.error) {
    console.error(`FAILED ${email}: ${submitted.error.message}`);
    continue;
  }
  const id = (submitted.data as { id: number }).id;

  if (t.outcome !== 'submitted') {
    await admin.db.from('applications').update({ status: 'under_review' }).eq('id', id);
  }
  if (['approved', 'rejected', 'changes_requested'].includes(t.outcome)) {
    await admin.db.from('applications').update({ status: t.outcome, admin_note: 'note' in t ? t.note : null }).eq('id', id);
  }
  if ('stall' in t) {
    const stall = (await service.from('stalls').select('id').eq('market_id', market.id).eq('code', t.stall).limit(1)).data?.[0] as { id: number };
    const days = (await service.from('market_days').select('id').eq('market_id', market.id).in('day', [...t.days])).data as { id: number }[];
    for (const day of days) {
      await admin.db.from('stall_allocations').insert({ market_id: market.id, application_id: id, stall_id: stall.id, market_day_id: day.id });
    }
  }
  console.log(`ok     ${email}  ${t.name}  ->  ${t.outcome}`);
}

console.log('\nDemo logins (all use DEMO_PASSWORD): admin@demo.example, trader1@demo.example ... trader8@demo.example');
