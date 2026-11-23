import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, apply, cleanUp, CLYDE, createAdmin, createTrader, decide, upload, validApplication, type TestUser } from './helpers.js';

let admin: TestUser;
let otherAdmin: TestUser;
let aisha: TestUser;
let ben: TestUser;
let candles: number;
let streetFood: number;

beforeAll(async () => {
  [admin, otherAdmin, aisha, ben] = await Promise.all([createAdmin(), createAdmin(CLYDE), createTrader('aisha'), createTrader('ben')]);
  candles = await apply(aisha, { business_name: 'Admin Test Candles' });
  const registration = await upload(ben, 'trader-documents', 'food-registration.pdf');
  streetFood = await apply(ben, {
    business_name: 'Admin Test Street Food',
    contact_name: 'Ben Carter',
    category: 'food_drink',
    stall_type: 'food_van',
    food_registration: registration.path,
    needs_power: true,
    power_requirement: 'two_plus_sockets',
  });
});
afterAll(cleanUp);

const ids = (rows: { id: number }[]) => rows.map((r) => r.id);

describe('who may use the admin routes', () => {
  it('turns away visitors and traders', async () => {
    await api.get('/api/admin/applications').expect(401);
    const res = await api.get('/api/admin/applications').set(aisha.auth).expect(403);
    expect(res.body.error).toBe('forbidden');
    await api.patch(`/api/admin/applications/${candles}/status`).set(aisha.auth).send({ status: 'approved' }).expect(403);
  });

  it('shows an administrator their own market only', async () => {
    const mine = await api.get('/api/admin/applications').set(admin.auth).expect(200);
    expect(ids(mine.body)).toEqual(expect.arrayContaining([candles, streetFood]));

    const theirs = await api.get('/api/admin/applications').set(otherAdmin.auth).expect(200);
    expect(ids(theirs.body)).not.toContain(candles);
    await api.get(`/api/admin/applications/${candles}`).set(otherAdmin.auth).expect(404);
    await api.patch(`/api/admin/applications/${candles}/status`).set(otherAdmin.auth).send({ status: 'under_review' }).expect(404);
  });

  it('filters the queue by status and category', async () => {
    const food = await api.get('/api/admin/applications?status=submitted&category=food_drink').set(admin.auth).expect(200);
    expect(ids(food.body)).toContain(streetFood);
    expect(ids(food.body)).not.toContain(candles);
    await api.get('/api/admin/applications?status=nonsense').set(admin.auth).expect(422);
  });
});

describe('reviewing an application', () => {
  it('shows the full application with email, document links and history', async () => {
    const res = await api.get(`/api/admin/applications/${streetFood}`).set(admin.auth).expect(200);
    expect(res.body).toMatchObject({ business_name: 'Admin Test Street Food', contact_name: 'Ben Carter', email: ben.email, status: 'submitted' });
    expect(res.body.documents.food_registration).toContain('/object/sign/trader-documents/');
    expect(res.body.documents.gas_safety_certificate).toBeNull();
    expect(res.body.history[0]).toMatchObject({ action: 'application_submitted' });
  });

  it('enforces the review workflow', async () => {
    const skip = await api.patch(`/api/admin/applications/${candles}/status`).set(admin.auth).send({ status: 'approved' }).expect(409);
    expect(skip.body.error).toBe('invalid_status_transition');

    await api.patch(`/api/admin/applications/${candles}/status`).set(admin.auth).send({ status: 'under_review' }).expect(200);

    const noReason = await api.patch(`/api/admin/applications/${candles}/status`).set(admin.auth).send({ status: 'rejected' }).expect(422);
    expect(noReason.body.fields).toHaveProperty('admin_note');

    await api.patch(`/api/admin/applications/${candles}/status`).set(admin.auth).send({ status: 'withdrawn' }).expect(422);
  });

  it('lets the trader respond to a change request, which resubmits the application', async () => {
    const asked = await api
      .patch(`/api/admin/applications/${candles}/status`)
      .set(admin.auth)
      .send({ status: 'changes_requested', admin_note: 'Please confirm which days you can attend.' })
      .expect(200);
    expect(asked.body).toMatchObject({ status: 'changes_requested', admin_note: 'Please confirm which days you can attend.' });

    const [seen] = (await api.get('/api/applications/me').set(aisha.auth)).body;
    expect(seen.admin_note).toBe('Please confirm which days you can attend.');

    const edited = await api.patch(`/api/applications/${candles}`).set(aisha.auth).send(validApplication({ business_name: 'Admin Test Candles' })).expect(200);
    expect(edited.body.status).toBe('submitted');
  });

  it('approves, records the decision time and makes the listing public', async () => {
    const before = await api.get('/api/traders').expect(200);
    expect(ids(before.body)).not.toContain(candles);

    const approved = await decide(admin, candles, 'approved');
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('approved');
    expect(approved.body.decided_at).toBeTruthy();

    const after = await api.get('/api/traders?category=crafts_gifts').expect(200);
    const listing = after.body.find((t: { id: number }) => t.id === candles);
    expect(listing).toBeTruthy();
    // The public listing carries listing fields only.
    expect(Object.keys(listing).sort()).toEqual([
      'business_name', 'category', 'category_label', 'description', 'id', 'logo_url', 'social_link', 'stalls', 'website_url',
    ]);
  });

  it('treats a decision as final, for the administrator and the trader', async () => {
    await api.patch(`/api/admin/applications/${candles}/status`).set(admin.auth).send({ status: 'rejected', admin_note: 'Changed our minds.' }).expect(409);
    await api.patch(`/api/applications/${candles}`).set(aisha.auth).send(validApplication()).expect(409);
    await api.post(`/api/applications/${candles}/withdraw`).set(aisha.auth).expect(409);
  });

  it('rejects with a reason the trader can read', async () => {
    const rejected = await decide(admin, streetFood, 'rejected', 'The food category is full this year.');
    expect(rejected.body.status).toBe('rejected');
    const [seen] = (await api.get('/api/applications/me').set(ben.auth)).body;
    expect(seen).toMatchObject({ status: 'rejected', admin_note: 'The food category is full this year.' });
    const directory = await api.get('/api/traders').expect(200);
    expect(ids(directory.body)).not.toContain(streetFood);
  });
});

describe('allocating stalls', () => {
  let stall: { stall_id: number; market_day_id: number; code: string };
  let allocationId: number;

  beforeAll(async () => {
    const map = await api.get('/api/stall-map?day=2026-12-05');
    stall = map.body.stalls.find((s: { code: string; trader: unknown }) => s.code === 'C4' && !s.trader);
  });

  it('gives an approved trader a stall and shows it on the public map', async () => {
    const res = await api
      .post('/api/admin/allocations')
      .set(admin.auth)
      .send({ application_id: candles, stall_id: stall.stall_id, market_day_id: stall.market_day_id })
      .expect(201);
    allocationId = res.body.id;

    const map = await api.get('/api/stall-map?day=2026-12-05').expect(200);
    const onMap = map.body.stalls.find((s: { code: string }) => s.code === 'C4');
    expect(onMap.trader).toMatchObject({ id: candles, business_name: 'Admin Test Candles' });

    const listing = await api.get(`/api/traders/${candles}`).expect(200);
    expect(listing.body.stalls).toEqual([{ date: '2026-12-05', stall: 'C4' }]);

    const [mine] = (await api.get('/api/applications/me').set(aisha.auth)).body;
    expect(mine.allocations[0]).toMatchObject({ date: '2026-12-05', stall: 'C4' });
  });

  it('refuses double bookings, unrequested days, unapproved traders and outsiders', async () => {
    const map = await api.get('/api/stall-map?day=2026-12-05');
    const free = map.body.stalls.find((s: { trader: unknown }) => !s.trader);

    const twice = await api.post('/api/admin/allocations').set(admin.auth)
      .send({ application_id: candles, stall_id: free.stall_id, market_day_id: stall.market_day_id }).expect(409);
    expect(twice.body.error).toBe('conflict');

    const otherDay = await api.get('/api/stall-map?day=2026-12-19');
    const wrongDay = await api.post('/api/admin/allocations').set(admin.auth)
      .send({ application_id: candles, stall_id: stall.stall_id, market_day_id: otherDay.body.stalls[0].market_day_id }).expect(409);
    expect(wrongDay.body.error).toBe('day_not_requested');

    const rejected = await api.post('/api/admin/allocations').set(admin.auth)
      .send({ application_id: streetFood, stall_id: free.stall_id, market_day_id: stall.market_day_id }).expect(409);
    expect(rejected.body.error).toBe('application_not_approved');

    await api.post('/api/admin/allocations').set(otherAdmin.auth)
      .send({ application_id: candles, stall_id: free.stall_id, market_day_id: stall.market_day_id }).expect(409);
    await api.post('/api/admin/allocations').set(aisha.auth)
      .send({ application_id: candles, stall_id: free.stall_id, market_day_id: stall.market_day_id }).expect(403);
    await api.post('/api/admin/allocations').set(admin.auth).send({ application_id: 'x' }).expect(422);
  });

  it('removes an allocation', async () => {
    await api.delete(`/api/admin/allocations/${allocationId}`).set(otherAdmin.auth).expect(404);
    await api.delete(`/api/admin/allocations/${allocationId}`).set(admin.auth).expect(204);
    const listing = await api.get(`/api/traders/${candles}`).expect(200);
    expect(listing.body.stalls).toEqual([]);
  });
});

describe('dashboard, enquiries and site content', () => {
  it('returns totals for the dashboard', async () => {
    const res = await api.get('/api/admin/stats').set(admin.auth).expect(200);
    expect(res.body.total_applications).toBeGreaterThanOrEqual(2);
    expect(res.body.by_status.approved).toBeGreaterThanOrEqual(1);
    expect(res.body.by_category.map((c: { category: string }) => c.category)).toContain('food_drink');
    expect(res.body.by_day).toHaveLength(8);
  });

  it('keeps an audit trail without personal details', async () => {
    const res = await api.get('/api/admin/audit-log?limit=200').set(admin.auth).expect(200);
    const mine = res.body.filter((row: { entity_id: number }) => row.entity_id === candles).map((row: { action: string }) => row.action);
    expect(mine).toEqual(expect.arrayContaining(['application_submitted', 'application_approved', 'stall_allocated', 'stall_unallocated']));
    expect(JSON.stringify(res.body)).not.toMatch(/Aisha|Rahman|07700|PA2 8AB/);
    const approval = res.body.find((row: { entity_id: number; action: string }) => row.entity_id === candles && row.action === 'application_approved');
    expect(approval.actor_id).toBe(admin.id);
  });

  it('puts data protection concerns in the administrator\'s queue', async () => {
    await api.post('/api/enquiries').send({ type: 'data_protection', message: 'Please delete the data you hold about me.', name: 'Sam', email: 'Sam@Example.com' }).expect(201);

    const queue = await api.get('/api/admin/enquiries?type=data_protection&status=new').set(admin.auth).expect(200);
    const enquiry = queue.body.find((e: { email: string }) => e.email === 'sam@example.com');
    expect(enquiry).toBeTruthy();

    const elsewhere = await api.get('/api/admin/enquiries').set(otherAdmin.auth).expect(200);
    expect(elsewhere.body.map((e: { id: number }) => e.id)).not.toContain(enquiry.id);

    const done = await api.patch(`/api/admin/enquiries/${enquiry.id}`).set(admin.auth).send({ status: 'acknowledged' }).expect(200);
    expect(done.body.acknowledged_at).toBeTruthy();
    await api.patch(`/api/admin/enquiries/${enquiry.id}`).set(otherAdmin.auth).send({ status: 'closed' }).expect(404);
  });

  it('manages announcements; drafts stay private', async () => {
    const draft = await api.post('/api/admin/announcements').set(admin.auth).send({ title: 'Draft notice', body: 'Not ready yet.', published: false }).expect(201);
    let publicList = await api.get('/api/announcements').expect(200);
    expect(publicList.body.map((a: { id: number }) => a.id)).not.toContain(draft.body.id);

    await api.patch(`/api/admin/announcements/${draft.body.id}`).set(otherAdmin.auth).send({ published: true }).expect(404);
    await api.patch(`/api/admin/announcements/${draft.body.id}`).set(admin.auth).send({ published: true, title: 'Santa arrives on Saturday' }).expect(200);
    publicList = await api.get('/api/announcements').expect(200);
    expect(publicList.body.map((a: { title: string }) => a.title)).toContain('Santa arrives on Saturday');

    await api.post('/api/admin/announcements').set(aisha.auth).send({ title: 'Trader notice', body: 'Should not work.' }).expect(403);
    await api.delete(`/api/admin/announcements/${draft.body.id}`).set(admin.auth).expect(204);
    await api.delete(`/api/admin/announcements/${draft.body.id}`).set(admin.auth).expect(404);
  });

  it('lets an administrator close applications for their own market', async () => {
    const trader = await createTrader('late');
    const form = validApplication({ category: 'kitchenware', stall_type: 'market_table', market_days: ['2027-07-17'], insurance_expiry: '2027-12-31' });

    await api.patch('/api/admin/market').set(otherAdmin.auth).send({ applications_open: false }).expect(200);
    try {
      const closed = await api.post(`/api/applications?market=${CLYDE}`).set(trader.auth).send(form).expect(409);
      expect(closed.body.error).toBe('applications_closed');
    } finally {
      await api.patch('/api/admin/market').set(otherAdmin.auth).send({ applications_open: true }).expect(200);
    }
    await api.post(`/api/applications?market=${CLYDE}`).set(trader.auth).send(form).expect(201);

    await api.patch('/api/admin/market').set(admin.auth).send({ slug: 'renamed' }).expect(422);
    await api.patch('/api/admin/market').set(admin.auth).send({ primary_colour: 'red' }).expect(422);
  });
});
