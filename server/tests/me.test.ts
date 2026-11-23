import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, apply, cleanUp, createAdmin, createTrader, decide, service, upload, type TestUser } from './helpers.js';

let admin: TestUser;
let aisha: TestUser;
let ben: TestUser;
let aishaApplication: number;

beforeAll(async () => {
  [admin, aisha, ben] = await Promise.all([createAdmin(), createTrader('aisha'), createTrader('ben')]);
  const logo = await upload(aisha, 'trader-logos', 'logo.png', 'image/png');
  aishaApplication = await apply(aisha, { business_name: 'My Data Candles', marketing_opt_in: true, logo: logo.path });
  await apply(ben, { business_name: 'My Data Baubles', contact_name: 'Ben Carter', category: 'decorations' });
});
afterAll(cleanUp);

describe('right of access', () => {
  it('returns everything held about the logged-in user, and nobody else', async () => {
    const res = await api.get('/api/me/data').set(aisha.auth).expect(200);
    expect(res.body.account).toMatchObject({ id: aisha.id, email: aisha.email });
    expect(res.body.profile).toMatchObject({ contact_name: 'Aisha Rahman', phone: '07700 900123' });
    expect(res.body.applications).toHaveLength(1);
    expect(res.body.applications[0].business_name).toBe('My Data Candles');
    expect(res.body.consents.map((c: { purpose: string; granted: boolean }) => `${c.purpose}:${c.granted}`).sort()).toEqual([
      'marketing:true', 'privacy_policy:true',
    ]);
    expect(res.body.consents[0].wording).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain('My Data Baubles');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('can be downloaded as a file (data portability)', async () => {
    const res = await api.get('/api/me/data?download=true').set(aisha.auth).expect(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="?my-data\.json"?$/);
  });
});

describe('right to rectification', () => {
  it('lets a user correct their contact details', async () => {
    const res = await api.patch('/api/me').set(aisha.auth).send({ contact_name: 'Aisha R. Rahman', phone: '0141 496 0000' }).expect(200);
    expect(res.body).toMatchObject({ contact_name: 'Aisha R. Rahman', phone: '0141 496 0000' });
    await api.patch('/api/me').set(aisha.auth).send({ contact_name: 'A', phone: 'nope' }).expect(422);

    const other = await api.get('/api/me/data').set(ben.auth).expect(200);
    expect(other.body.profile.contact_name).toBe('Ben Carter');
  });

  it('creates a profile for a user who has not applied yet', async () => {
    const fresh = await createTrader('fresh');
    const res = await api.patch('/api/me').set(fresh.auth).send({ contact_name: 'Fresh Trader', phone: '07700 900999' }).expect(200);
    expect(res.body.contact_name).toBe('Fresh Trader');
  });
});

describe('consent', () => {
  it('records a withdrawal as a new row and ignores repeats', async () => {
    await api.put('/api/me/consents/marketing').set(aisha.auth).send({ granted: false }).expect(200);
    await api.put('/api/me/consents/marketing').set(aisha.auth).send({ granted: false }).expect(200);
    const res = await api.get('/api/me/data').set(aisha.auth).expect(200);
    const marketing = res.body.consents.filter((c: { purpose: string }) => c.purpose === 'marketing');
    expect(marketing.map((c: { granted: boolean }) => c.granted)).toEqual([false, true]);
    await api.put('/api/me/consents/marketing').set(aisha.auth).send({ granted: 'yes' }).expect(422);
  });
});

describe('right to erasure', () => {
  it('needs an explicit confirmation', async () => {
    await api.delete('/api/me').set(aisha.auth).send({}).expect(422);
    await api.delete('/api/me').expect(401);
  });

  it('deletes the account, its data, its files and its public listing', async () => {
    await decide(admin, aishaApplication, 'approved');
    const before = await api.get(`/api/traders/${aishaApplication}`).expect(200);
    expect(before.body.business_name).toBe('My Data Candles');
    expect((await service.storage.from('trader-logos').list(aisha.id)).data).toHaveLength(1);

    const res = await api.delete('/api/me').set(aisha.auth).send({ confirm: 'DELETE' }).expect(200);
    expect(res.body).toEqual({ deleted: true });

    await api.get(`/api/traders/${aishaApplication}`).expect(404);
    expect((await service.storage.from('trader-logos').list(aisha.id)).data).toEqual([]);
    const leftovers = await service.from('applications').select('id').eq('trader_id', aisha.id);
    expect(leftovers.data).toEqual([]);
    const profile = await service.from('profiles').select('id').eq('id', aisha.id);
    expect(profile.data).toEqual([]);
    const consents = await service.from('consents').select('id').eq('trader_id', aisha.id);
    expect(consents.data).toEqual([]);

    // The old token is still signed, but there is nothing left for it to read.
    const after = await api.get('/api/applications/me').set(aisha.auth).expect(200);
    expect(after.body).toEqual([]);

    // The audit log keeps a record that a deletion happened.
    const log = await api.get('/api/admin/audit-log?limit=200').set(admin.auth).expect(200);
    expect(log.body.some((row: { action: string; entity_id: number }) => row.action === 'application_deleted' && row.entity_id === aishaApplication)).toBe(true);
  });

  it('leaves other users untouched', async () => {
    const res = await api.get('/api/me/data').set(ben.auth).expect(200);
    expect(res.body.applications).toHaveLength(1);
  });
});
