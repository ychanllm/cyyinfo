import type { D1Migration } from 'cloudflare:test';
import type { Env } from '../src/types';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {
    MIGRATIONS: D1Migration[];
  }
}
