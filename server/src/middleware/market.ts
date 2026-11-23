// Picks the market from ?market=<slug> or the X-Market header, falling back to DEFAULT_MARKET_SLUG
import type { NextFunction, Request, Response } from 'express';
import type { MarketFormConfig } from '../../../shared/application.js';
import { ApiError, unwrap } from '../lib/errors.js';
import { config } from '../config.js';
import { publicClient } from '../supabase.js';

// Public columns only 
const MARKET_COLUMNS =
  'id, slug, name, tagline, description, location_name, location_postcode, latitude, longitude, ' +
  'start_date, end_date, contact_email, primary_colour, secondary_colour, accent_colour, logo_url, ' +
  'applications_open, privacy_policy_version, marketing_wording, ' +
  'retention_unsuccessful_months, retention_enquiry_months, retention_audit_months';

export interface Market {
  id: string;
  slug: string;
  name: string;
  start_date: string;
  end_date: string;
  applications_open: boolean;
  [column: string]: unknown;
}

declare module 'express-serve-static-core' {
  interface Request {
    market?: Market;
  }
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export async function resolveMarket(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const requested = typeof req.query.market === 'string' ? req.query.market : req.get('x-market');
  const slug = (requested ?? config.defaultMarketSlug).toLowerCase();
  if (!SLUG.test(slug)) throw new ApiError(404, 'market_not_found', 'Market not found.');

  const rows = unwrap(await publicClient().from('markets').select(MARKET_COLUMNS).eq('slug', slug).limit(1));
  const market = (rows as unknown as Market[])[0];
  if (!market) throw new ApiError(404, 'market_not_found', 'Market not found.');

  req.market = market;
  next();
}

export function market(req: Request): Market {
  if (!req.market) throw new ApiError(404, 'market_not_found', 'Market not found.');
  return req.market;
}

export interface MarketLists {
  categories: { code: string; label: string; requires_food_registration: boolean }[];
  stall_types: { code: string; label: string; fee_per_day_pence: number | null }[];
  market_days: { id: number; date: string; opens_at: string; closes_at: string }[];
}


export async function loadMarketLists(marketId: string): Promise<MarketLists> {
  const db = publicClient();
  const [categories, stallTypes, days] = await Promise.all([
    db.from('market_categories').select('code, label, requires_food_registration').eq('market_id', marketId).order('sort_order'),
    db.from('market_stall_types').select('code, label, fee_per_day_pence').eq('market_id', marketId).order('sort_order'),
    db.from('market_days').select('id, day, opens_at, closes_at').eq('market_id', marketId).order('day'),
  ]);

  return {
    categories: unwrap(categories) as MarketLists['categories'],
    stall_types: unwrap(stallTypes) as MarketLists['stall_types'],
    market_days: (unwrap(days) as { id: number; day: string; opens_at: string; closes_at: string }[]).map((d) => ({
      id: d.id,
      date: d.day,
      opens_at: d.opens_at.slice(0, 5),
      closes_at: d.closes_at.slice(0, 5),
    })),
  };
}

export function toFormConfig(m: Market, lists: MarketLists): MarketFormConfig {
  return {
    categories: lists.categories,
    stall_types: lists.stall_types,
    market_days: lists.market_days.map((d) => d.date),
    end_date: m.end_date,
  };
}
