import { handle } from 'hono/cloudflare-pages';
import app from '../_lib/index';

export const onRequest = handle(app);
