import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import type { SQL } from 'drizzle-orm';
import type { Env } from './auth';
import { ApiError } from './auth';
export interface Database { query<T extends Record<string, unknown>>(statement: SQL): Promise<T[]> }
export function database(env: Env): Database {
  if (!env.DATABASE_URL) throw new ApiError(503, 'DATABASE_NOT_CONFIGURED');
  const host = new URL(env.DATABASE_URL).hostname;
  if (!host.endsWith('.neon.tech')) throw new ApiError(503, 'NEON_DATABASE_REQUIRED');
  if (env.APP_ENV === 'development' && (!env.DEVELOPMENT_DATABASE_HOST || host !== env.DEVELOPMENT_DATABASE_HOST)) throw new ApiError(503, 'DEVELOPMENT_DATABASE_MISMATCH');
  const db = drizzle({ client: neon(env.DATABASE_URL, { fetchOptions: { signal: AbortSignal.timeout(15000) } }) });
  return { async query<T extends Record<string, unknown>>(statement: SQL) { return (await db.execute(statement)).rows as T[]; } };
}
