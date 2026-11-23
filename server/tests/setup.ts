
import { existsSync } from 'node:fs';

if (existsSync('.env.test')) process.loadEnvFile('.env.test');

process.env.CRON_SECRET ??= 'test-cron-secret-0123456789';
process.env.DEFAULT_MARKET_SLUG ??= 'paisley';

const url = process.env.SUPABASE_URL ?? '';

if (!url) {
  throw new Error('SUPABASE_URL is not set. Run `supabase start` and create .env.test (see docs/SETUP.md).');
}


const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1'].includes(host) && process.env.ALLOW_REMOTE_TESTS !== 'true') {
  throw new Error(`Refusing to run tests against ${host}. Tests are for a local Supabase stack only.`);
}
