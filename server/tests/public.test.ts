import { describe, expect, it } from 'vitest';
import { api, CLYDE } from './helpers.js';

describe('public routes (no login)', () => {
  it('reports that the API is running', async () => {
    const res = await api.get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('describes the market and the lists the application form needs', async () => {
    const res = await api.get('/api/market').expect(200);
    expect(res.body).toMatchObject({ slug: 'paisley', name: 'Paisley Christmas Markets', start_date: '2026-11-28', end_date: '2026-12-20' });
    expect(res.body.categories.map((c: { code: string }) => c.code)).toEqual([
      'food_drink', 'crafts_gifts', 'clothing_accessories', 'decorations', 'other',
    ]);
    expect(res.body.categories[0].requires_food_registration).toBe(true);
    expect(res.body.stall_types.map((s: { code: string }) => s.code)).toEqual(['gazebo_3x3', 'wooden_chalet', 'food_van']);
    expect(res.body.market_days).toHaveLength(8);
    expect(res.body.market_days[0]).toMatchObject({ date: '2026-11-28', opens_at: '10:00', closes_at: '20:00' });
   
    expect(res.body.retention_unsuccessful_months).toBe(6);
    expect(res.body).not.toHaveProperty('created_at');
    expect(res.headers['cdn-cache-control']).toContain('s-maxage');
    expect(res.headers.vary).toContain('X-Market');
    expect(res.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
  });

  it('serves a second, differently branded market from the same code (generic pattern)', async () => {
    const paisley = await api.get('/api/market').expect(200);
    const clyde = await api.get(`/api/market?market=${CLYDE}`).expect(200);
    expect(clyde.body.name).toBe('Clyde Coast Food Festival');
    expect(clyde.body.primary_colour).not.toBe(paisley.body.primary_colour);
    expect(clyde.body.categories.map((c: { code: string }) => c.code)).toContain('street_food');
    expect(clyde.body.market_days).toHaveLength(2);
  });

  it('returns 404 in the agreed error shape for an unknown market', async () => {
    const res = await api.get('/api/market?market=atlantis').expect(404);
    expect(res.body).toEqual({ error: 'market_not_found', message: 'Market not found.' });
  });

  it('lists market days', async () => {
    const res = await api.get('/api/market-days').expect(200);
    expect(res.body).toHaveLength(8);
    expect(res.body[7].date).toBe('2026-12-20');
  });

  it('returns the stall map for a market day', async () => {
    const res = await api.get('/api/stall-map?day=2026-12-05').expect(200);
    expect(res.body.date).toBe('2026-12-05');
    expect(res.body.stalls).toHaveLength(40);
    expect(res.body.stalls[0]).toMatchObject({ code: 'A1', stall_type: 'wooden_chalet', has_power: true });
    expect(typeof res.body.stalls[0].map_x).toBe('number');
    await api.get('/api/stall-map?day=2026-12-25').expect(404);
    await api.get('/api/stall-map?day=tomorrow').expect(422);
  });

  it('lists published announcements, newest first', async () => {
    const res = await api.get('/api/announcements').expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(3);
    expect(res.body[0].published_at >= res.body[1].published_at).toBe(true);
  });

  it('accepts a contact form message and validates it', async () => {
    const ok = await api
      .post('/api/enquiries')
      .send({ type: 'data_protection', message: 'Please tell me what data you hold about me.', email: 'sam@example.com' })
      .expect(201);
    expect(ok.body.type).toBe('data_protection');
    expect(ok.body.acknowledgement).toContain('30 days');

    const bad = await api.post('/api/enquiries').send({ message: 'Hi', email: 'not-an-email' }).expect(422);
    expect(bad.body.error).toBe('validation_failed');
    expect(Object.keys(bad.body.fields).sort()).toEqual(['email', 'message']);
  });

  it('does not let visitors read enquiries, applications or admin data', async () => {
    await api.get('/api/admin/enquiries').expect(401);
    await api.get('/api/applications/me').expect(401);
    await api.get('/api/me/data').expect(401);
  });

  it('answers unknown addresses and bad JSON in the agreed error shape', async () => {
    const missing = await api.get('/api/nothing-here').expect(404);
    expect(missing.body.error).toBe('not_found');
    const broken = await api.post('/api/enquiries').set('Content-Type', 'application/json').send('{"message": ').expect(400);
    expect(broken.body.error).toBe('invalid_json');
  });

  it('publishes its own documentation', async () => {
    const spec = await api.get('/api/openapi.json').expect(200);
    expect(spec.body.openapi).toMatch(/^3\./);
    expect(Object.keys(spec.body.paths)).toContain('/applications');
    const page = await api.get('/api/docs').expect(200);
    expect(page.text).toContain('swagger-ui');
  });
});
