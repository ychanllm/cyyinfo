import { handle } from 'hono/cloudflare-pages';
import app from '../../../worker/src/index';

export const onRequest = handle(app);
