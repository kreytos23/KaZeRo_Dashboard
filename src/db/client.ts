import 'server-only';
import { env } from '@/server/env';
import { conDbUrl, type Db } from './pool';

export type { Db };

export function conDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return conDbUrl(env().DATABASE_URL, fn);
}
