import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.js';

// The API is stateless: it never stores or refreshes a session of its own.
const serverSide = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

let cachedPublic: SupabaseClient | undefined;
let cachedService: SupabaseClient | undefined;

export function publicClient(): SupabaseClient {
  cachedPublic ??= createClient(config.supabaseUrl, config.publishableKey, serverSide);
  return cachedPublic;
}


export function userClient(accessToken: string): SupabaseClient {
  return createClient(config.supabaseUrl, config.publishableKey, {
    ...serverSide,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

// Secret key, bypasses RLS.
export function serviceClient(): SupabaseClient {
  cachedService ??= createClient(config.supabaseUrl, config.secretKey, serverSide);
  return cachedService;
}

export function logoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${config.supabaseUrl}/storage/v1/object/public/trader-logos/${encoded}`;
}
