// The admin's market always comes from their token app_metadata.market_id
import { Router } from 'express';
import { z } from 'zod';
import { APPLICATION_STATUSES } from '../../../shared/application.js';
import { BUCKETS, DOCUMENT_LINK_SECONDS } from '../config.js';
import { notFound, unwrap } from '../lib/errors.js';
import { idParam, parse } from '../lib/http.js';
import { adminMarketId, auth, authenticate, requireAdmin } from '../middleware/auth.js';
import { logoUrl, serviceClient } from '../supabase.js';

export const adminRouter = Router();

adminRouter.use(authenticate, requireAdmin);

// Applications

/** GET /api/admin/applications?status=&category= - the review queue. */
adminRouter.get('/applications', async (req, res) => {
  const filters = parse(
    z.object({
      status: z.enum(APPLICATION_STATUSES).optional(),
      category: z.string().regex(/^[a-z0-9_]{2,40}$/).optional(),
    }),
    { status: req.query.status, category: req.query.category },
  );

  let query = auth(req).db.from('application_details').select('*').eq('market_id', adminMarketId(req));
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.category) query = query.eq('category', filters.category);

  res.json(unwrap(await query.order('submitted_at', { ascending: true })));
});

/** GET /api/admin/applications/:id - full application with email, document links and history. */
adminRouter.get('/applications/:id', async (req, res) => {
  const id = idParam(req);
  const { db } = auth(req);

  const rows = unwrap(
    await db.from('application_details').select('*').eq('id', id).eq('market_id', adminMarketId(req)).limit(1),
  ) as Record<string, unknown>[];
  const application = rows[0];
  // No row means it doesn't exist or RLS hid it. Either way it's a 404.
  if (!application) throw notFound('Application not found');

  const [email, history] = await Promise.all([
    db.rpc('admin_get_trader_email', { p_application_id: id }),
    db
      .from('audit_log')
      .select('action, actor_id, detail, created_at')
      .eq('entity', 'application')
      .eq('entity_id', id)
      .order('created_at', { ascending: true }),
  ]);

  // Private bucket, so the admin gets a signed link that expires after a few
  // minutes instead of permanent access.
  const documents: Record<string, string | null> = {};
  for (const field of ['food_registration', 'gas_safety_certificate'] as const) {
    const path = application[`${field}_path`] as string | null;
    if (!path) {
      documents[field] = null;
      continue;
    }
    const signed = await serviceClient().storage.from(BUCKETS.documents).createSignedUrl(path, DOCUMENT_LINK_SECONDS);
    documents[field] = signed.data?.signedUrl ?? null;
  }

  res.json({
    ...application,
    email: unwrap(email),
    logo_url: logoUrl(application.logo_path as string | null),
    documents,
    documents_expire_in_seconds: DOCUMENT_LINK_SECONDS,
    history: unwrap(history),
  });
});

const statusSchema = z.object({
  status: z.enum(['under_review', 'approved', 'rejected', 'changes_requested'], {
    error: 'Status must be under_review, approved, rejected or changes_requested',
  }),
  admin_note: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.string().trim().max(1000, 'Keep the note to 1000 characters or fewer').optional(),
  ),
});

// PATCH /api/admin/applications/:id/status. The applications_guard trigger enforces
// submitted -> under_review -> approved | rejected | changes_requested.
adminRouter.patch('/applications/:id/status', async (req, res) => {
  const body = parse(statusSchema, req.body);
  const changes: Record<string, unknown> = { status: body.status };
  if (body.admin_note !== undefined) changes.admin_note = body.admin_note;

  const rows = unwrap(
    await auth(req)
      .db.from('applications')
      .update(changes)
      .eq('id', idParam(req))
      .eq('market_id', adminMarketId(req))
      .select('id, status, admin_note, decided_at, updated_at'),
  ) as unknown[];
  if (!rows[0]) throw notFound('Application not found');
  res.json(rows[0]);
});

// Stall allocation

const allocationSchema = z.object({
  application_id: z.int({ error: 'application_id is required' }).positive(),
  stall_id: z.int({ error: 'stall_id is required' }).positive(),
  market_day_id: z.int({ error: 'market_day_id is required' }).positive(),
});

/** POST /api/admin/allocations - give an approved trader a stall on one day. */
adminRouter.post('/allocations', async (req, res) => {
  const body = parse(allocationSchema, req.body);
  const rows = unwrap(
    await auth(req)
      .db.from('stall_allocations')
      .insert({ ...body, market_id: adminMarketId(req) })
      .select('id, application_id, stall_id, market_day_id, created_at'),
  ) as unknown[];
  res.status(201).json(rows[0]);
});

adminRouter.delete('/allocations/:id', async (req, res) => {
  const rows = unwrap(
    await auth(req)
      .db.from('stall_allocations')
      .delete()
      .eq('id', idParam(req))
      .eq('market_id', adminMarketId(req))
      .select('id'),
  ) as unknown[];
  if (!rows[0]) throw notFound('Allocation not found');
  res.status(204).end();
});

// Dashboard

/** GET /api/admin/stats - totals for the dashboard charts. */
adminRouter.get('/stats', async (req, res) => {
  res.json(unwrap(await auth(req).db.rpc('admin_stats', { p_market_id: adminMarketId(req) })));
});

/** GET /api/admin/audit-log - who did what, most recent first. */
adminRouter.get('/audit-log', async (req, res) => {
  const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }), {
    limit: req.query.limit,
  });
  res.json(
    unwrap(
      await auth(req)
        .db.from('audit_log')
        .select('id, actor_id, action, entity, entity_id, detail, created_at')
        .eq('market_id', adminMarketId(req))
        .order('created_at', { ascending: false })
        .limit(limit),
    ),
  );
});

// Enquiries, including data protection concerns

adminRouter.get('/enquiries', async (req, res) => {
  const filters = parse(
    z.object({
      type: z.enum(['general', 'feedback', 'data_protection']).optional(),
      status: z.enum(['new', 'acknowledged', 'closed']).optional(),
    }),
    { type: req.query.type, status: req.query.status },
  );

  let query = auth(req)
    .db.from('enquiries')
    .select('id, type, name, email, message, status, created_at, acknowledged_at')
    .eq('market_id', adminMarketId(req));
  if (filters.type) query = query.eq('type', filters.type);
  if (filters.status) query = query.eq('status', filters.status);

  res.json(unwrap(await query.order('created_at', { ascending: false })));
});

adminRouter.patch('/enquiries/:id', async (req, res) => {
  const body = parse(z.object({ status: z.enum(['acknowledged', 'closed'], { error: 'Status must be acknowledged or closed' }) }), req.body);
  const changes: Record<string, unknown> = { status: body.status };
  if (body.status === 'acknowledged') changes.acknowledged_at = new Date().toISOString();

  const rows = unwrap(
    await auth(req)
      .db.from('enquiries')
      .update(changes)
      .eq('id', idParam(req))
      .eq('market_id', adminMarketId(req))
      .select('id, type, status, acknowledged_at'),
  ) as unknown[];
  if (!rows[0]) throw notFound('Enquiry not found');
  res.json(rows[0]);
});

// Site content

const announcementSchema = z.object({
  title: z.string({ error: 'Title is required' }).trim().min(3, 'Title must be at least 3 characters').max(120),
  body: z.string({ error: 'Body is required' }).trim().min(3, 'Body must be at least 3 characters').max(2000),
  published: z.boolean().default(true),
});

const ANNOUNCEMENT_COLUMNS = 'id, title, body, published, published_at, updated_at';

adminRouter.get('/announcements', async (req, res) => {
  res.json(
    unwrap(
      await auth(req)
        .db.from('announcements')
        .select(ANNOUNCEMENT_COLUMNS)
        .eq('market_id', adminMarketId(req))
        .order('published_at', { ascending: false }),
    ),
  );
});

adminRouter.post('/announcements', async (req, res) => {
  const body = parse(announcementSchema, req.body);
  const rows = unwrap(
    await auth(req)
      .db.from('announcements')
      .insert({ ...body, market_id: adminMarketId(req), created_by: auth(req).userId })
      .select(ANNOUNCEMENT_COLUMNS),
  ) as unknown[];
  res.status(201).json(rows[0]);
});

adminRouter.patch('/announcements/:id', async (req, res) => {
  const body = parse(announcementSchema.partial(), req.body);
  const rows = unwrap(
    await auth(req)
      .db.from('announcements')
      .update(body)
      .eq('id', idParam(req))
      .eq('market_id', adminMarketId(req))
      .select(ANNOUNCEMENT_COLUMNS),
  ) as unknown[];
  if (!rows[0]) throw notFound('Announcement not found');
  res.json(rows[0]);
});

adminRouter.delete('/announcements/:id', async (req, res) => {
  const rows = unwrap(
    await auth(req)
      .db.from('announcements')
      .delete()
      .eq('id', idParam(req))
      .eq('market_id', adminMarketId(req))
      .select('id'),
  ) as unknown[];
  if (!rows[0]) throw notFound('Announcement not found');
  res.status(204).end();
});

const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #7a1f2b');

const marketSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    tagline: z.string().trim().max(200),
    description: z.string().trim().max(2000),
    location_name: z.string().trim().max(120),
    location_postcode: z.string().trim().max(10),
    contact_email: z.string().trim().max(254),
    primary_colour: colour,
    secondary_colour: colour,
    accent_colour: colour,
    applications_open: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Send at least one field to change');

/** PATCH /api/admin/market - branding, contact details, open or close applications. */
adminRouter.patch('/market', async (req, res) => {
  const body = parse(marketSchema, req.body);
  const rows = unwrap(
    await auth(req)
      .db.from('markets')
      .update(body)
      .eq('id', adminMarketId(req))
      .select('id, slug, name, tagline, applications_open, primary_colour, secondary_colour, accent_colour, updated_at'),
  ) as unknown[];
  if (!rows[0]) throw notFound('Market not found');
  res.json(rows[0]);
});
