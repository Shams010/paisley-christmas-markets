// Public routes, no login. 
import { Router } from 'express';
import { z } from 'zod';
import { notFound, unwrap } from '../lib/errors.js';
import { cachePublicly, idParam, isoDate, parse } from '../lib/http.js';
import { loadMarketLists, market, resolveMarket } from '../middleware/market.js';
import { logoUrl, publicClient } from '../supabase.js';

export const publicRouter = Router();

publicRouter.use(resolveMarket);

interface TraderRow {
  id: number;
  business_name: string;
  category: string;
  category_label: string;
  description: string;
  website_url: string | null;
  social_link: string | null;
  logo_path: string | null;
  stalls: { date: string; stall: string }[];
}

const TRADER_COLUMNS = 'id, business_name, category, category_label, description, website_url, social_link, logo_path, stalls';

function toTrader(row: TraderRow) {
  const { logo_path, ...rest } = row;
  return { ...rest, logo_url: logoUrl(logo_path) };
}

publicRouter.get('/market', async (req, res) => {
  const m = market(req);
  const lists = await loadMarketLists(m.id);
  cachePublicly(res);
  res.json({ ...m, ...lists });
});

publicRouter.get('/market-days', async (req, res) => {
  const lists = await loadMarketLists(market(req).id);
  cachePublicly(res);
  res.json(lists.market_days);
});

/** The traders directory, approved traders only, listing fields only. */
publicRouter.get('/traders', async (req, res) => {
  const { category } = parse(z.object({ category: z.string().regex(/^[a-z0-9_]{2,40}$/).optional() }), {
    category: req.query.category,
  });

  let query = publicClient().from('public_traders').select(TRADER_COLUMNS).eq('market_id', market(req).id);
  if (category) query = query.eq('category', category);

  const rows = unwrap(await query.order('business_name')) as unknown as TraderRow[];
  cachePublicly(res);
  res.json(rows.map(toTrader));
});

publicRouter.get('/traders/:id', async (req, res) => {
  const rows = unwrap(
    await publicClient()
      .from('public_traders')
      .select(TRADER_COLUMNS)
      .eq('market_id', market(req).id)
      .eq('id', idParam(req))
      .limit(1),
  ) as unknown as TraderRow[];
  if (!rows[0]) throw notFound('Trader not found');
  cachePublicly(res);
  res.json(toTrader(rows[0]));
});

/** One entry per stall for the chosen day, with the trader on it if allocated. */
publicRouter.get('/stall-map', async (req, res) => {
  const m = market(req);
  const { day } = parse(z.object({ day: isoDate.optional() }), { day: req.query.day });
  const lists = await loadMarketLists(m.id);
  const dates = lists.market_days.map((d) => d.date);

  // Default to today if it is a market day, otherwise the next one, otherwise the first.
  const today = new Date().toISOString().slice(0, 10);
  const chosen = day ?? dates.find((d) => d >= today) ?? dates[0];
  if (!chosen || !dates.includes(chosen)) throw notFound('That is not a market day');

  const rows = unwrap(
    await publicClient()
      .from('public_stall_map')
      .select('stall_id, code, stall_type, stall_type_label, has_power, map_x, map_y, market_day_id, day, trader_id, trader_name, trader_category')
      .eq('market_id', m.id)
      .eq('day', chosen)
      .order('code'),
  ) as unknown as Record<string, unknown>[];

  cachePublicly(res);
  res.json({
    date: chosen,
    market_days: dates,
    stalls: rows.map(({ day: _day, trader_id, trader_name, trader_category, ...stall }) => ({
      ...stall,
      map_x: Number(stall.map_x),
      map_y: Number(stall.map_y),
      // "trader.id" is the public listing id, usable with GET /traders/:id.
      trader: trader_id ? { id: trader_id, business_name: trader_name, category: trader_category } : null,
    })),
  });
});

publicRouter.get('/announcements', async (req, res) => {
  const rows = unwrap(
    await publicClient()
      .from('announcements')
      .select('id, title, body, published_at')
      .eq('market_id', market(req).id)
      .eq('published', true)
      .order('published_at', { ascending: false })
      .limit(20),
  );
  cachePublicly(res);
  res.json(rows);
});

const enquirySchema = z.object({
  type: z.enum(['general', 'feedback', 'data_protection']).default('general'),
  message: z
    .string({ error: 'Message is required' })
    .trim()
    .min(10, 'Message must be at least 10 characters')
    .max(2000, 'Message must be at most 2000 characters'),
  name: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().trim().max(80).optional()),
  email: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.string().trim().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address').optional(),
  ),
});


publicRouter.post('/enquiries', async (req, res) => {
  const body = parse(enquirySchema, req.body);
  const saved = unwrap(
    await publicClient().rpc('submit_enquiry', {
      p_market_slug: market(req).slug,
      p_type: body.type,
      p_message: body.message,
      p_name: body.name ?? null,
      p_email: body.email ?? null,
    }),
  ) as { id: number; type: string; created_at: string };

  res.status(201).json({
    ...saved,
    acknowledgement:
      body.type === 'data_protection'
        ? 'We have received your data protection concern and will respond within 30 days.'
        : 'Thank you. We have received your message.',
  });
});
