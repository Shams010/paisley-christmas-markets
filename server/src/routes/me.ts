import { Router } from 'express';
import { z } from 'zod';
import { BUCKETS } from '../config.js';
import { ApiError, unwrap } from '../lib/errors.js';
import { parse } from '../lib/http.js';
import { auth, authenticate } from '../middleware/auth.js';
import { market, resolveMarket } from '../middleware/market.js';
import { publicClient, serviceClient } from '../supabase.js';

export const meRouter = Router();

meRouter.use(authenticate);


meRouter.get('/data', async (req, res) => {
  const { db, userId, token } = auth(req);

  const [account, profile, applications, consents] = await Promise.all([
    publicClient().auth.getUser(token),
    db.from('profiles').select('contact_name, phone, created_at, updated_at').eq('id', userId).limit(1),
    db.from('application_details').select('*').eq('trader_id', userId).order('submitted_at', { ascending: false }),
    db
      .from('consents')
      .select('market_id, purpose, granted, wording, wording_version, created_at')
      .eq('trader_id', userId)
      .order('created_at', { ascending: false }),
  ]);

  const user = account.data.user;
  const exported = {
    exported_at: new Date().toISOString(),
    account: {
      id: userId,
      email: user?.email ?? auth(req).email,
      created_at: user?.created_at ?? null,
      last_sign_in_at: user?.last_sign_in_at ?? null,
    },
    profile: (unwrap(profile) as unknown[])[0] ?? null,
    applications: unwrap(applications),
    consents: unwrap(consents),
  };

  if (req.query.download === 'true') {
    res.attachment('my-data.json');
  }
  res.json(exported);
});

const profileSchema = z.object({
  contact_name: z.string().trim().min(2, 'Contact name must be at least 2 characters').max(80),
  phone: z
    .string()
    .trim()
    .refine((value) => /^(?:\+44|0)\d{9,10}$/.test(value.replace(/[\s\-()]/g, '')), 'Enter a UK phone number'),
});


meRouter.patch('/', async (req, res) => {
  const { db, userId } = auth(req);
  const body = parse(profileSchema, req.body);
  const columns = 'contact_name, phone, updated_at';

  let rows = unwrap(await db.from('profiles').update(body).eq('id', userId).select(columns)) as unknown[];
  if (!rows[0]) {
    
    rows = unwrap(await db.from('profiles').insert({ id: userId, ...body }).select(columns)) as unknown[];
  }
  res.json(rows[0]);
});

meRouter.put('/consents/marketing', resolveMarket, async (req, res) => {
  const body = parse(z.object({ granted: z.boolean({ error: 'Send granted: true or false' }) }), req.body);
  const saved = unwrap(
    await auth(req).db.rpc('set_marketing_consent', { p_market_slug: market(req).slug, p_granted: body.granted }),
  );
  res.json(saved);
});

// Needs the secret key because a user token can't delete an auth user. The id comes
// from the verified token, never the body, so users can only ever delete themselves.
meRouter.delete('/', async (req, res) => {
  const { userId } = auth(req);
  parse(z.object({ confirm: z.literal('DELETE', { error: 'Send { "confirm": "DELETE" } to confirm' }) }), req.body);

  const service = serviceClient();

  
  for (const bucket of [BUCKETS.documents, BUCKETS.logos]) {
    const listed = await service.storage.from(bucket).list(userId, { limit: 1000 });
    if (listed.error) throw new ApiError(502, 'storage_error', 'Could not remove your files. Nothing was deleted; try again.');
    const paths = listed.data.map((file) => `${userId}/${file.name}`);
    if (paths.length > 0) {
      const removed = await service.storage.from(bucket).remove(paths);
      if (removed.error) throw new ApiError(502, 'storage_error', 'Could not remove your files. Nothing was deleted; try again.');
    }
  }

  // Deleting the auth user cascades to the profile, applications, days, allocations and consents.
  const deleted = await service.auth.admin.deleteUser(userId);
  if (deleted.error) {
    console.error('Account deletion failed', deleted.error);
    throw new ApiError(502, 'deletion_failed', 'Your account could not be deleted. Try again.');
  }

  res.json({ deleted: true });
});
