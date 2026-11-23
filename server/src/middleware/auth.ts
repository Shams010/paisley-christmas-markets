// The frontend sends its Supabase access token as "Authorization: Bearer <token>".
// getClaims() verifies the JWT signature, so forged or expired tokens stop here.
import type { NextFunction, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '../lib/errors.js';
import { publicClient, userClient } from '../supabase.js';

export interface AuthContext {
  token: string;
  userId: string;
  email: string | null;
  
  adminMarketId: string | null;
  /** A Supabase client that acts as this user (Row Level Security applies). */
  db: SupabaseClient;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) {
    throw new ApiError(401, 'not_authenticated', 'Log in first.');
  }
  const token = header.slice(7).trim();

  const { data, error } = await publicClient().auth.getClaims(token);
  const claims = data?.claims;
  if (error || !claims?.sub || claims.role !== 'authenticated') {
    throw new ApiError(401, 'invalid_token', 'Your session has expired. Log in again.');
  }

  // The role comes from app_metadata, which only the server can write.
  const appMetadata = (claims.app_metadata ?? {}) as { role?: string; market_id?: string };
  const isAdmin = appMetadata.role === 'admin' && typeof appMetadata.market_id === 'string';

  req.auth = {
    token,
    userId: claims.sub,
    email: claims.email ?? null,
    adminMarketId: isAdmin ? appMetadata.market_id! : null,
    db: userClient(token),
  };
  next();
}

/** Use after authenticate. Rejects anyone who is not an administrator. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth?.adminMarketId) {
    throw new ApiError(403, 'forbidden', 'Administrators only.');
  }
  next();
}

/** Typed access to req.auth for routes behind authenticate. */
export function auth(req: Request): AuthContext {
  if (!req.auth) throw new ApiError(401, 'not_authenticated', 'Log in first.');
  return req.auth;
}

/** For routes behind requireAdmin. */
export function adminMarketId(req: Request): string {
  const id = req.auth?.adminMarketId;
  if (!id) throw new ApiError(403, 'forbidden', 'Administrators only.');
  return id;
}
