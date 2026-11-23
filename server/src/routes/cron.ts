// Nightly retention job. Vercel cron calls it with "Bearer <CRON_SECRET>" (see vercel.json)
// so the privacy notice's retention periods are kept without anyone having to remember.
import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { ApiError, unwrap } from '../lib/errors.js';
import { serviceClient } from '../supabase.js';

export const cronRouter = Router();

interface StoredFile {
  bucket: string;
  path: string;
}

function isAuthorised(header: string | undefined): boolean {
  const secret = config.cronSecret;
  if (!secret || !header) return false;
  
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

async function removeFiles(files: StoredFile[]): Promise<number> {
  const byBucket = new Map<string, string[]>();
  for (const file of files) {
    byBucket.set(file.bucket, [...(byBucket.get(file.bucket) ?? []), file.path]);
  }

  let removed = 0;
  for (const [bucket, paths] of byBucket) {
    const result = await serviceClient().storage.from(bucket).remove(paths);
    if (result.error) {
      
      console.error(`Could not remove files from ${bucket}`, result.error);
    } else {
      removed += paths.length;
    }
  }
  return removed;
}

cronRouter.get('/retention', async (req, res) => {
  if (!isAuthorised(req.get('authorization'))) {
    throw new ApiError(401, 'not_authenticated', 'This address is for the scheduled job only.');
  }
  const service = serviceClient();

  const purged = unwrap(await service.rpc('purge_expired_data')) as {
    applications_deleted: number;
    enquiries_deleted: number;
    audit_rows_deleted: number;
    files: StoredFile[];
  };
  const orphans = unwrap(await service.rpc('orphaned_uploads')) as StoredFile[];

  const filesRemoved = await removeFiles([...purged.files, ...orphans]);

  
  const summary = {
    ran_at: new Date().toISOString(),
    applications_deleted: purged.applications_deleted,
    enquiries_deleted: purged.enquiries_deleted,
    audit_rows_deleted: purged.audit_rows_deleted,
    files_removed: filesRemoved,
  };
  console.log('Retention job finished', summary);
  res.json(summary);
});
