import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';

export const api = request(createApp());

const stateless = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

export const service: SupabaseClient = createClient(config.supabaseUrl, config.secretKey, stateless);

export const PAISLEY = 'paisley';
export const CLYDE = 'clyde-coast-food-festival';

export interface TestUser {
  id: string;
  email: string;
  token: string;
  auth: { Authorization: string };
  supabase: SupabaseClient;
}

const created: string[] = [];

export async function marketId(slug: string): Promise<string> {
  const { data, error } = await service.from('markets').select('id').eq('slug', slug).limit(1);
  if (error || !data?.[0]) throw new Error(`Market ${slug} not found. Has supabase/seed.sql been applied?`);
  return data[0].id as string;
}

async function createUser(prefix: string, appMetadata?: Record<string, unknown>): Promise<TestUser> {
  const email = `${prefix}-${randomUUID().slice(0, 8)}@tests.example`;
  const password = `Pw-${randomUUID()}`;

  const made = await service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: appMetadata });
  if (made.error || !made.data.user) throw new Error(`Could not create ${email}: ${made.error?.message}`);
  created.push(made.data.user.id);

  const login = await createClient(config.supabaseUrl, config.publishableKey, stateless).auth.signInWithPassword({ email, password });
  if (login.error || !login.data.session) throw new Error(`Could not log in as ${email}: ${login.error?.message}`);
  const token = login.data.session.access_token;

  return {
    id: made.data.user.id,
    email,
    token,
    auth: { Authorization: `Bearer ${token}` },
    supabase: createClient(config.supabaseUrl, config.publishableKey, {
      ...stateless,
      global: { headers: { Authorization: `Bearer ${token}` } },
    }),
  };
}

export const createTrader = (name = 'trader') => createUser(name);

export async function createAdmin(slug = PAISLEY): Promise<TestUser> {
  return createUser('admin', { role: 'admin', market_id: await marketId(slug) });
}

export async function cleanUp(): Promise<void> {
  while (created.length > 0) {
    await service.auth.admin.deleteUser(created.pop()!);
  }
}

export function validApplication(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    business_name: `Gleniffer Candle Co. ${randomUUID().slice(0, 6)}`,
    contact_name: 'Aisha Rahman',
    phone: '07700 900123',
    postcode: 'pa2 8ab',
    category: 'crafts_gifts',
    description: 'Hand-poured soy candles and wax melts in winter scents, made in Paisley.',
    stall_type: 'gazebo_3x3',
    needs_power: false,
    power_requirement: 'none',
    market_days: ['2026-12-05', '2026-12-06'],
    insurance_expiry: '2027-03-31',
    website_url: 'https://candles.example',
    is_over_18: true,
    accept_privacy_policy: true,
    marketing_opt_in: false,
    ...overrides,
  };
}

export async function upload(user: TestUser, bucket: 'trader-documents' | 'trader-logos', fileName: string, contentType = 'application/pdf') {
  const path = `${user.id}/${randomUUID().slice(0, 8)}-${fileName}`;
  const result = await user.supabase.storage.from(bucket).upload(path, Buffer.from('%PDF-1.4 test file'), { contentType });
  return { path, error: result.error };
}

export async function apply(user: TestUser, overrides: Record<string, unknown> = {}, market = PAISLEY): Promise<number> {
  const response = await api.post(`/api/applications?market=${market}`).set(user.auth).send(validApplication(overrides));
  if (response.status !== 201) throw new Error(`apply failed: ${response.status} ${JSON.stringify(response.body)}`);
  return response.body.id as number;
}

export async function decide(admin: TestUser, id: number, status: 'approved' | 'rejected' | 'changes_requested', note?: string) {
  await api.patch(`/api/admin/applications/${id}/status`).set(admin.auth).send({ status: 'under_review' }).expect(200);
  return api.patch(`/api/admin/applications/${id}/status`).set(admin.auth).send({ status, admin_note: note });
}
