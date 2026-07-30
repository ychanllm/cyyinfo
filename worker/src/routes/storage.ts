import { Hono } from 'hono';
import type { Env } from '../types';

const storage = new Hono<{ Bindings: Env }>();

storage.get('/:path{.+}', async (c) => {
  const key = c.req.param('path');
  const obj = await c.env.UPLOADS.get(key);
  if (!obj) return c.json({ detail: '文件不存在' }, 404);
  const headers = new Headers();
  headers.set('Content-Type', obj.httpMetadata?.contentType ?? 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=2592000');
  headers.set('ETag', obj.httpEtag);
  return new Response(obj.body, { headers });
});

export default storage;
