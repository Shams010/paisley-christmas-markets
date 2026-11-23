// Trader routes. Everything uses the user's own client so RLS decides access
import { Router } from 'express';
import { buildApplicationSchema, fieldErrors } from '../../../shared/application.js';
import { ApiError, notFound, unwrap, validationFailed } from '../lib/errors.js';
import { idParam } from '../lib/http.js';
import { auth, authenticate } from '../middleware/auth.js';
import { loadMarketLists, market, resolveMarket, toFormConfig, type Market } from '../middleware/market.js';
import { logoUrl, publicClient } from '../supabase.js';

export const applicationsRouter = Router();

applicationsRouter.use(authenticate, resolveMarket);

async function validateForm(m: Market, body: unknown) {
  const lists = await loadMarketLists(m.id);
  const result = buildApplicationSchema(toFormConfig(m, lists)).safeParse(body ?? {});
  if (!result.success) throw validationFailed(fieldErrors(result.error));
  return result.data;
}

/** POST /api/applications - submit the application form. */
applicationsRouter.post('/', async (req, res) => {
  const m = market(req);
  if (!m.applications_open) {
    throw new ApiError(409, 'applications_closed', 'Applications for this market are closed.');
  }
  const form = await validateForm(m, req.body);

  // submit_application saves the profile, application, days and consents in one transaction
  const saved = unwrap(
    await auth(req).db.rpc('submit_application', { p_market_slug: m.slug, p_application: form }),
  );
  res.status(201).json(saved);
});

/** GET /api/applications/me - the logged-in trader's applications for this market. */
applicationsRouter.get('/me', async (req, res) => {
  const { db, userId } = auth(req);
  const rows = unwrap(
    await db
      .from('application_details')
      .select('*')
      .eq('trader_id', userId)
      .eq('market_id', market(req).id)
      .order('submitted_at', { ascending: false }),
  ) as Record<string, unknown>[];

  res.json(rows.map((row) => ({ ...row, logo_url: logoUrl(row.logo_path as string | null) })));
});

// PATCH /api/applications/:id takes the whole form again. Only allowed while "submitted"
// or "changes_requested"; editing after changes were requested resubmits it.
applicationsRouter.patch('/:id', async (req, res) => {
  const id = idParam(req);
  const { db, userId } = auth(req);

  // Need the market to validate against its categories and days.
  const owned = unwrap(
    await db.from('applications').select('id, market_id').eq('id', id).eq('trader_id', userId).limit(1),
  ) as { id: number; market_id: string }[];
  if (!owned[0]) throw notFound('Application not found');

  const markets = unwrap(await publicClient().from('markets').select('*').eq('id', owned[0].market_id).limit(1));
  const m = (markets as Market[])[0]!;
  const form = await validateForm(m, req.body);

  const saved = unwrap(await db.rpc('update_application', { p_application_id: id, p_application: form }));
  res.json(saved);
});


applicationsRouter.post(['/:id/withdrawal', '/:id/withdraw'], async (req, res) => {
  const { db, userId } = auth(req);
  const rows = unwrap(
    await db
      .from('applications')
      .update({ status: 'withdrawn' })
      .eq('id', idParam(req))
      .eq('trader_id', userId)
      .select('id, status, updated_at'),
  ) as unknown[];
  if (!rows[0]) throw notFound('Application not found');
  res.json(rows[0]);
});
