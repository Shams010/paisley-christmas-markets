import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, apply, cleanUp, createTrader, upload, validApplication, type TestUser } from './helpers.js';

let aisha: TestUser;
let ben: TestUser;

beforeAll(async () => {
  [aisha, ben] = await Promise.all([createTrader('aisha'), createTrader('ben')]);
});
afterAll(cleanUp);

describe('applying for a stall', () => {
  it('requires a valid login', async () => {
    const none = await api.post('/api/applications').send(validApplication()).expect(401);
    expect(none.body.error).toBe('not_authenticated');
    const forged = await api.post('/api/applications').set('Authorization', 'Bearer not.a.real-token').send(validApplication()).expect(401);
    expect(forged.body.error).toBe('invalid_token');
  });

  it('rejects an invalid form with one message per field', async () => {
    const res = await api
      .post('/api/applications')
      .set(aisha.auth)
      .send(validApplication({
        business_name: 'X',
        phone: '12345',
        postcode: 'NOT A POSTCODE',
        category: 'fireworks',
        description: 'Too short',
        market_days: ['2026-12-25'],
        insurance_expiry: '2026-12-20',
        website_url: 'http://insecure.example',
        is_over_18: false,
        accept_privacy_policy: false,
      }))
      .expect(422);

    expect(res.body.error).toBe('validation_failed');
    expect(Object.keys(res.body.fields).sort()).toEqual([
      'accept_privacy_policy', 'business_name', 'category', 'description', 'insurance_expiry', 'is_over_18',
      'market_days', 'phone', 'postcode', 'website_url',
    ]);
    expect(res.body.fields.postcode).toBe('Enter a valid UK postcode');
    expect(res.body.fields.insurance_expiry).toBe('Insurance must be valid until after the last market day');
  });

  it('checks that fields agree with each other', async () => {
    const res = await api
      .post('/api/applications')
      .set(aisha.auth)
      .send(validApplication({ needs_power: true, power_requirement: 'none' }))
      .expect(422);
    expect(res.body.fields).toEqual({ power_requirement: 'Choose how much power you need' });
  });

  it('reports missing required fields', async () => {
    const res = await api.post('/api/applications').set(aisha.auth).send({}).expect(422);
    expect(res.body.fields).toMatchObject({ business_name: 'Business name is required', market_days: 'Choose at least one day' });
  });

  it('accepts a valid form and returns a receipt', async () => {
    const res = await api.post('/api/applications').set(aisha.auth).send(validApplication({ business_name: 'Gleniffer Candle Co.', marketing_opt_in: true })).expect(201);
    expect(res.body).toMatchObject({ status: 'submitted' });
    expect(typeof res.body.id).toBe('number');
    expect(res.body.submitted_at).toBeTruthy();
  });

  it('shows the trader their own application, with tidy values', async () => {
    const res = await api.get('/api/applications/me').set(aisha.auth).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      business_name: 'Gleniffer Candle Co.',
      contact_name: 'Aisha Rahman',
      postcode: 'PA2 8AB',
      status: 'submitted',
      category_label: 'Crafts & gifts',
      market_days: ['2026-12-05', '2026-12-06'],
      allocations: [],
    });
  });

  it('does not show it to another trader', async () => {
    const res = await api.get('/api/applications/me').set(ben.auth).expect(200);
    expect(res.body).toEqual([]);
  });

  it('refuses a second live application for the same market', async () => {
    const res = await api.post('/api/applications').set(aisha.auth).send(validApplication()).expect(409);
    expect(res.body.error).toBe('application_exists');
  });

  it('lets the trader edit while the application is open', async () => {
    const [mine] = (await api.get('/api/applications/me').set(aisha.auth)).body;
    await api
      .patch(`/api/applications/${mine.id}`)
      .set(aisha.auth)
      .send(validApplication({ business_name: 'Gleniffer Candles', market_days: ['2026-12-12'], needs_power: true, power_requirement: 'one_socket' }))
      .expect(200);
    const [after] = (await api.get('/api/applications/me').set(aisha.auth)).body;
    expect(after).toMatchObject({ business_name: 'Gleniffer Candles', market_days: ['2026-12-12'], power_requirement: 'one_socket' });
  });

  it('does not let another trader edit or withdraw it', async () => {
    const [mine] = (await api.get('/api/applications/me').set(aisha.auth)).body;
    await api.patch(`/api/applications/${mine.id}`).set(ben.auth).send(validApplication()).expect(404);
    await api.post(`/api/applications/${mine.id}/withdrawal`).set(ben.auth).expect(404);
    const [after] = (await api.get('/api/applications/me').set(aisha.auth)).body;
    expect(after.status).toBe('submitted');
  });

  it('lets the trader withdraw and then apply again', async () => {
    const [mine] = (await api.get('/api/applications/me').set(aisha.auth)).body;
    const withdrawn = await api.post(`/api/applications/${mine.id}/withdrawal`).set(aisha.auth).expect(200);
    expect(withdrawn.body.status).toBe('withdrawn');
    await api.patch(`/api/applications/${mine.id}`).set(aisha.auth).send(validApplication()).expect(409);
    await apply(aisha, { business_name: 'Gleniffer Candles (second try)' });
    const all = (await api.get('/api/applications/me').set(aisha.auth)).body;
    expect(all.map((a: { status: string }) => a.status).sort()).toEqual(['submitted', 'withdrawn']);
  });
});

describe('food traders and uploaded documents', () => {
  it('requires a food business registration for food categories', async () => {
    const res = await api.post('/api/applications').set(ben.auth).send(validApplication({ category: 'food_drink', stall_type: 'food_van' })).expect(422);
    expect(res.body.fields).toEqual({ food_registration: 'Upload your food business registration' });
  });

  it('only accepts PDFs and images, and only in the trader\'s own folder', async () => {
    const html = await upload(ben, 'trader-documents', 'page.html', 'text/html');
    expect(html.error).toBeTruthy();

    const elsewhere = await ben.supabase.storage
      .from('trader-documents')
      .upload(`${aisha.id}/planted.pdf`, Buffer.from('%PDF-1.4'), { contentType: 'application/pdf' });
    expect(elsewhere.error).toBeTruthy();
  });

  it('refuses a document path that belongs to someone else', async () => {
    const theirs = await upload(aisha, 'trader-documents', 'food-registration.pdf');
    expect(theirs.error).toBeNull();
    const res = await api
      .post('/api/applications')
      .set(ben.auth)
      .send(validApplication({ category: 'food_drink', stall_type: 'food_van', food_registration: theirs.path }))
      .expect(422);
    expect(res.body.fields).toEqual({ food_registration: 'Upload this file again' });
  });

  it('requires a gas safety certificate when LPG is used', async () => {
    const registration = await upload(ben, 'trader-documents', 'food-registration.pdf');
    const res = await api
      .post('/api/applications')
      .set(ben.auth)
      .send(validApplication({ category: 'food_drink', stall_type: 'food_van', food_registration: registration.path, uses_lpg: true }))
      .expect(422);
    expect(res.body.fields).toEqual({ gas_safety_certificate: 'Upload your gas safety certificate' });
  });

  it('accepts a complete food application with documents and a logo', async () => {
    const [registration, gas, logo] = await Promise.all([
      upload(ben, 'trader-documents', 'food-registration.pdf'),
      upload(ben, 'trader-documents', 'gas-safety.pdf'),
      upload(ben, 'trader-logos', 'logo.png', 'image/png'),
    ]);
    expect([registration.error, gas.error, logo.error]).toEqual([null, null, null]);

    await api
      .post('/api/applications')
      .set(ben.auth)
      .send(validApplication({
        business_name: 'Seedhill Street Food',
        category: 'food_drink',
        stall_type: 'food_van',
        needs_power: true,
        power_requirement: 'high_load',
        uses_lpg: true,
        food_registration: registration.path,
        gas_safety_certificate: gas.path,
        logo: logo.path,
        social_link: 'https://instagram.com/seedhillstreetfood',
        additional_requirements: 'Needs level ground for the van.',
      }))
      .expect(201);

    const [mine] = (await api.get('/api/applications/me').set(ben.auth)).body;
    expect(mine).toMatchObject({ uses_lpg: true, power_requirement: 'high_load', food_registration_path: registration.path });
    expect(mine.logo_url).toContain('/storage/v1/object/public/trader-logos/');
  });
});
