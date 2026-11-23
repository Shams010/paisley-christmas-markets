import type { Request, Response } from 'express';
import { z } from 'zod';
import { fieldErrors } from '../../../shared/application.js';
import { notFound, validationFailed } from './errors.js';

/** Validates a request query and returns the cleaned value. */
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value ?? {});
  if (!result.success) throw validationFailed(fieldErrors(result.error));
  return result.data;
}

/** Reads a numeric id from the URL Anything else is a 404. */
export function idParam(req: Request, name = 'id'): number {
  const raw = String(req.params[name] ?? '');
  if (!/^[1-9]\d{0,14}$/.test(raw)) throw notFound();
  return Number(raw);
}

// Lets Vercel's CDN cache public
export function cachePublicly(res: Response, seconds = 60): void {
  
  res.set('Cache-Control', 'public, max-age=0, must-revalidate');
  res.set('CDN-Cache-Control', `public, s-maxage=${seconds}, stale-while-revalidate=${seconds * 5}`);
  res.vary('X-Market');
}

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date as YYYY-MM-DD');
