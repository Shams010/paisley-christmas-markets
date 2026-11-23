import { describe, expect, it } from 'vitest';
import { api } from './helpers.js';

describe('nightly retention job', () => {
  it('can only be started with the shared secret', async () => {
    await api.get('/api/cron/retention').expect(401);
    await api.get('/api/cron/retention').set('Authorization', 'Bearer wrong-secret').expect(401);
  });

  it('runs and reports counts only', async () => {
    const res = await api.get('/api/cron/retention').set('Authorization', `Bearer ${process.env.CRON_SECRET}`).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['applications_deleted', 'audit_rows_deleted', 'enquiries_deleted', 'files_removed', 'ran_at']);
    expect(typeof res.body.applications_deleted).toBe('number');
  });
});
