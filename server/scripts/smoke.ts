// End-to-end check over HTTP against API_URL (defaults to localhost:3000). 
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { config } from '../src/config.js';
import { serviceClient } from '../src/supabase.js';

const base = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const slug = config.defaultMarketSlug;
const service = serviceClient();
const made: string[] = [];
let failed = false;

function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  ${detail}`}`);
  if (!ok) failed = true;
}

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function account(appMetadata?: Record<string, unknown>) {
  const email = `smoke-${randomUUID().slice(0, 8)}@smoke.example`;
  const password = `Pw-${randomUUID()}`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: appMetadata });
  if (created.error || !created.data.user) throw new Error(created.error?.message);
  made.push(created.data.user.id);
  const login = await createClient(config.supabaseUrl, config.publishableKey, { auth: { persistSession: false } })
    .auth.signInWithPassword({ email, password });
  if (login.error || !login.data.session) throw new Error(login.error?.message);
  return { id: created.data.user.id, token: login.data.session.access_token };
}

try {
  const health = await call('GET', '/health');
  check('API is reachable', health.status === 200);

  const market = await call('GET', `/market?market=${slug}`);
  check('market details load', market.status === 200 && market.body.market_days.length > 0);

  const trader = await account();
  const admin = await account({ role: 'admin', market_id: market.body.id });
  const nonFood = market.body.categories.find((c: { requires_food_registration: boolean }) => !c.requires_food_registration);
  const day = market.body.market_days[0].date;

  const applied = await call('POST', '/applications', trader.token, {
    business_name: `Smoke Test Stall ${randomUUID().slice(0, 4)}`,
    contact_name: 'Smoke Tester',
    phone: '07700 900123',
    postcode: 'PA1 1BN',
    category: nonFood.code,
    description: 'A temporary application created by the smoke test.',
    stall_type: market.body.stall_types[0].code,
    needs_power: false,
    power_requirement: 'none',
    market_days: [day],
    insurance_expiry: `${Number(market.body.end_date.slice(0, 4)) + 1}-12-31`,
    is_over_18: true,
    accept_privacy_policy: true,
  });
  check('trader can apply', applied.status === 201, JSON.stringify(applied.body));
  const id = applied.body?.id;

  const invalid = await call('POST', '/applications', trader.token, {});
  check('invalid form is rejected with field messages', invalid.status === 422 && !!invalid.body.fields);

  const anon = await call('GET', '/admin/applications');
  check('visitors cannot reach admin routes', anon.status === 401);
  const notAdmin = await call('GET', '/admin/applications', trader.token);
  check('traders cannot reach admin routes', notAdmin.status === 403);

  await call('PATCH', `/admin/applications/${id}/status`, admin.token, { status: 'under_review' });
  const approved = await call('PATCH', `/admin/applications/${id}/status`, admin.token, { status: 'approved' });
  check('administrator can approve', approved.status === 200 && approved.body.status === 'approved', JSON.stringify(approved.body));

  const listed = await call('GET', `/traders/${id}?market=${slug}`);
  check('approved trader appears in the public directory', listed.status === 200);

  const mine = await call('GET', '/me/data', trader.token);
  check('trader can export their data', mine.status === 200 && mine.body.applications.length === 1);

  const deleted = await call('DELETE', '/me', trader.token, { confirm: 'DELETE' });
  check('trader can delete their account', deleted.status === 200);
  made.splice(made.indexOf(trader.id), 1);

  const gone = await call('GET', `/traders/${id}?market=${slug}`);
  check('their listing is removed', gone.status === 404);
} catch (error) {
  check('smoke test ran to the end', false, String(error));
} finally {
  for (const id of made) await service.auth.admin.deleteUser(id);
}

console.log(failed ? '\nSome checks failed.' : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
