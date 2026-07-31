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

content.get('/albums/:id', async (c) => {
  const album = await c.env.DB.prepare(
    'SELECT a.*, p.filename AS cover_filename FROM albums a LEFT JOIN photos p ON p.id = a.cover_photo_id WHERE a.id = ?'
  ).bind(c.req.param('id')).first();
  if (!album) return c.json({ detail: '相册不存在' }, 404);
  const { results: photos } = await c.env.DB.prepare(
    'SELECT id, filename, caption, taken_at, sort_order FROM photos WHERE album_id = ? ORDER BY sort_order, id'
  ).bind(c.req.param('id')).all();
  return c.json({ ...album, photos });
});

content.get('/diaries', async (c) => {
  const page = Math.max(1, Number(c.req.query('page')) || 1);
  const size = 10;
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM diaries WHERE status = 'published'")
    .first<{ n: number }>();
  const { results } = await c.env.DB.prepare(
    `SELECT d.id, d.title, d.slug, d.cover_filename, d.published_at, u.display_name AS author,
            substr(d.content_md, 1, 200) AS excerpt
     FROM diaries d JOIN admin_users u ON u.id = d.author_id
     WHERE d.status = 'published' ORDER BY d.published_at DESC LIMIT ? OFFSET ?`
  ).bind(size, (page - 1) * size).all();
  return c.json({ items: results, total: total?.n ?? 0 });
});

content.get('/diaries/:slugOrId', async (c) => {
  const key = c.req.param('slugOrId');
  const isId = /^\d+$/.test(key);
  const d = await c.env.DB.prepare(
    `SELECT d.id, d.title, d.slug, d.content_md, d.cover_filename, d.published_at, u.display_name AS author
     FROM diaries d JOIN admin_users u ON u.id = d.author_id
     WHERE d.status = 'published' AND ${isId ? 'd.id = ?' : 'd.slug = ?'}`
  ).bind(key).first();
  if (!d) return c.json({ detail: '文章不存在' }, 404);
  return c.json(d);
});

content.get('/music/albums', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT m.*, COUNT(s.id) AS song_count FROM music_albums m
     LEFT JOIN songs s ON s.album_id = m.id GROUP BY m.id ORDER BY m.sort_order, m.id`
  ).all();
  return c.json(results);
});

content.get('/messages', async (c) => {
  const type = c.req.query('target_type') ?? 'site';
  const targetId = c.req.query('target_id');
  const sql = targetId
    ? 'SELECT id, nickname, content, created_at FROM messages WHERE is_approved = 1 AND target_type = ? AND target_id = ? ORDER BY id DESC LIMIT 100'
    : 'SELECT id, nickname, content, created_at FROM messages WHERE is_approved = 1 AND target_type = ? ORDER BY id DESC LIMIT 100';
  const stmt = targetId
    ? c.env.DB.prepare(sql).bind(type, Number(targetId))
    : c.env.DB.prepare(sql).bind(type);
  return c.json((await stmt.all()).results);
});

content.post('/messages', async (c) => {
  if (!rateLimit({ limit: 10, windowSec: 3600, key: `msg:${clientIp(c.req.raw)}` })) {
    return c.json({ detail: '留言过于频繁，请稍后再试' }, 429);
  }
  const { nickname, content: text, target_type = 'site', target_id = null } = await c.req.json();
  if (!nickname?.trim() || !text?.trim()) return c.json({ detail: '昵称和内容必填' }, 400);
  if (nickname.length > 20) return c.json({ detail: '昵称过长' }, 400);
  if (text.length > 500) return c.json({ detail: '内容过长（500 字以内）' }, 400);
  if (!['diary', 'photo', 'site'].includes(target_type)) return c.json({ detail: '非法目标类型' }, 400);
  await c.env.DB.prepare('INSERT INTO messages (nickname, content, target_type, target_id) VALUES (?, ?, ?, ?)')
    .bind(nickname.trim(), text.trim(), target_type, target_id).run();
  return c.json({ detail: '留言已提交，待审核' }, 202);
});

content.get('/music/albums/:id', async (c) => {
  const album = await c.env.DB.prepare('SELECT * FROM music_albums WHERE id = ?')
    .bind(c.req.param('id')).first();
  if (!album) return c.json({ detail: '专辑不存在' }, 404);
  const { results: songs } = await c.env.DB.prepare(
    'SELECT id, title, track_no, filename, duration FROM songs WHERE album_id = ? ORDER BY track_no, id'
  ).bind(c.req.param('id')).all();
  return c.json({ ...album, songs });
});

pub.route('/', content);
export default pub;
