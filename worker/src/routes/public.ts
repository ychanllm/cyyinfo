import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import type { Env } from '../types';
import { signJwt } from '../auth';
import { rateLimit, clientIp } from '../security';
import { contentGuard, getSetting } from '../guard';

const pub = new Hono<{ Bindings: Env }>();

pub.get('/site/status', async (c) => {
  const hash = await getSetting(c.env.DB, 'site_passcode_hash');
  return c.json({
    site_name: await getSetting(c.env.DB, 'site_name'),
    anniversary_date: await getSetting(c.env.DB, 'anniversary_date'),
    passcode_enabled: Boolean(hash),
  });
});

pub.post('/passcode/verify', async (c) => {
  if (!rateLimit({ limit: 5, windowSec: 900, key: `passcode:${clientIp(c.req.raw)}` })) {
    return c.json({ detail: '尝试过于频繁，请稍后再试' }, 429);
  }
  const hash = await getSetting(c.env.DB, 'site_passcode_hash');
  if (!hash) return c.json({ detail: '站点未启用访客口令' }, 400);
  const { passcode } = await c.req.json<{ passcode?: string }>();
  if (!passcode || !bcrypt.compareSync(passcode, hash)) {
    return c.json({ detail: '口令错误' }, 401);
  }
  const token = await signJwt(c.env, { role: 'guest' }, 24 * 7);
  return c.json({ token });
});

// 内容接口挂在 contentGuard 之后（后续任务在此追加路由）
const content = new Hono<{ Bindings: Env }>();
content.use('*', contentGuard);
content.get('/albums', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT a.*, p.filename AS cover_filename FROM albums a LEFT JOIN photos p ON p.id = a.cover_photo_id ORDER BY a.sort_order, a.id'
  ).all();
  return c.json(results);
});

pub.route('/', content);
export default pub;
