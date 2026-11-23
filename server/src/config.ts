
function read(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function must(...names: string[]): string {
  const value = read(...names);
  if (!value) {
    throw new Error(`Missing environment variable ${names.join(' or ')}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export const config = {
  get supabaseUrl() {
    return must('SUPABASE_URL').replace(/\/+$/, '');
  },
  /** Safe to expose. Requests made with it are limited by Row Level Security. */
  get publishableKey() {
    return must('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY');
  },
  /** Bypasses Row Level Security, so it must only ever be read on the server. */
  get secretKey() {
    return must('SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY');
  },
  /** Which market to use when a request does not name one. */
  get defaultMarketSlug() {
    return read('DEFAULT_MARKET_SLUG') ?? 'paisley';
  },
  /** Extra origins allowed to call the API from a browser. */
  get allowedOrigins() {
    return (read('ALLOWED_ORIGINS') ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  },
  /** Shared secret Vercel sends when it runs the nightly job. */
  get cronSecret() {
    return read('CRON_SECRET');
  },
  get port() {
    return Number(read('PORT') ?? 3000);
  },
  get isProduction() {
    return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
  },
};

export const BUCKETS = {
  documents: 'trader-documents',
  logos: 'trader-logos',
} as const;


export const DOCUMENT_LINK_SECONDS = 300;
