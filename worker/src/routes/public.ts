import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import type { Env } from '../types';
import { signJwt } from '../auth';
import { rateLimit, clientIp } from '../security';
import { contentGuard, getSetting } from '../guard';
import { sendEmail } from '../smtp';

const pub = new Hono<{ Bindings: Env }>();

// 公开内容按 ?lang= 返回对应语言（默认中文），英文为空时回退中文
function localized(c: { req: { query: (k: string) => string | undefined } }): 'en' | 'zh' {
  return c.req.query('lang') === 'en' ? 'en' : 'zh';
}

pub.get('/site/status', async (c) => {
  const hash = await getSetting(c.env.DB, 'site_passcode_hash');
  const isEn = localized(c) === 'en';
  const siteName = await getSetting(c.env.DB, 'site_name');
  const siteNameEn = await getSetting(c.env.DB, 'site_name_en');
  const heroLabel = await getSetting(c.env.DB, 'hero_label');
  const heroLabelEn = await getSetting(c.env.DB, 'hero_label_en');
  const heroTitle = await getSetting(c.env.DB, 'hero_title');
  const heroTitleEn = await getSetting(c.env.DB, 'hero_title_en');
  return c.json({
    site_name: isEn ? (siteNameEn || siteName) : siteName,
    anniversary_date: await getSetting(c.env.DB, 'anniversary_date'),
    passcode_enabled: Boolean(hash),
    background_color: await getSetting(c.env.DB, 'background_color'),
    hero_label: isEn ? (heroLabelEn || heroLabel) : heroLabel,
    hero_title: isEn ? (heroTitleEn || heroTitle) : heroTitle,
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

// 定时任务触发：查询到点未发送的提醒并发送邮件（用 x-reminder-token 鉴权）
pub.post('/reminders/check', async (c) => {
  const token = c.req.header('x-reminder-token');
  if (!c.env.REMINDER_TOKEN || token !== c.env.REMINDER_TOKEN) {
    return c.json({ detail: '未授权' }, 401);
  }
  // 当前中国时区(UTC+8)时间，与前端 datetime-local 存储的 send_at 对齐
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  const nowStr = `${now.getUTCFullYear()}-${p(now.getUTCMonth() + 1)}-${p(now.getUTCDate())} `
    + `${p(now.getUTCHours())}:${p(now.getUTCMinutes())}:${p(now.getUTCSeconds())}`;

  const { results: due } = await c.env.DB.prepare(
    'SELECT * FROM reminders WHERE status = ? AND send_at <= ? ORDER BY send_at'
  ).bind('pending', nowStr).all();

  const smtp = {
    host: (await getSetting(c.env.DB, 'smtp_host')) || 'smtp.qq.com',
    port: Number((await getSetting(c.env.DB, 'smtp_port')) || 465),
    user: await getSetting(c.env.DB, 'smtp_user'),
    pass: await getSetting(c.env.DB, 'smtp_pass'),
    from: await getSetting(c.env.DB, 'smtp_user'),
  };
  const defaultRecipient = await getSetting(c.env.DB, 'default_recipient');

  let sent = 0;
  for (const r of due) {
    const to = r.recipient || defaultRecipient;
    if (!to || !smtp.user || !smtp.pass) {
      await c.env.DB.prepare("UPDATE reminders SET status='failed', error='SMTP 未配置', updated_at=datetime('now') WHERE id=?")
        .bind(r.id).run();
      continue;
    }
    try {
      await sendEmail(smtp, to, `提醒：${r.title}`, r.content || r.title);
      await c.env.DB.prepare("UPDATE reminders SET status='sent', error='', updated_at=datetime('now') WHERE id=?")
        .bind(r.id).run();
      sent++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await c.env.DB.prepare("UPDATE reminders SET status='failed', error=?, updated_at=datetime('now') WHERE id=?")
        .bind(msg, r.id).run();
    }
  }
  return c.json({ checked: due.length, sent, failed: due.length - sent });
});

// 内容接口挂在 contentGuard 之后（后续任务在此追加路由）
const content = new Hono<{ Bindings: Env }>();
content.use('*', contentGuard);
content.get('/albums', async (c) => {
  const isEn = localized(c) === 'en';
  const sql = isEn
    ? `SELECT a.id, a.sort_order, a.created_at, a.cover_photo_id,
              COALESCE(NULLIF(a.title_en,''), a.title) AS title,
              COALESCE(NULLIF(a.description_en,''), a.description) AS description,
              p.filename AS cover_filename
       FROM albums a LEFT JOIN photos p ON p.id = a.cover_photo_id
       ORDER BY a.sort_order, a.id`
    : 'SELECT a.*, p.filename AS cover_filename FROM albums a LEFT JOIN photos p ON p.id = a.cover_photo_id ORDER BY a.sort_order, a.id';
  const { results } = await c.env.DB.prepare(sql).all();
  return c.json(results);
});

content.get('/albums/:id', async (c) => {
  const isEn = localized(c) === 'en';
  const albumSql = isEn
    ? `SELECT a.id, a.sort_order, a.created_at, a.cover_photo_id,
              COALESCE(NULLIF(a.title_en,''), a.title) AS title,
              COALESCE(NULLIF(a.description_en,''), a.description) AS description,
              p.filename AS cover_filename
       FROM albums a LEFT JOIN photos p ON p.id = a.cover_photo_id WHERE a.id = ?`
    : 'SELECT a.*, p.filename AS cover_filename FROM albums a LEFT JOIN photos p ON p.id = a.cover_photo_id WHERE a.id = ?';
  const album = await c.env.DB.prepare(albumSql).bind(c.req.param('id')).first();
  if (!album) return c.json({ detail: '相册不存在' }, 404);
  const photosSql = isEn
    ? 'SELECT id, filename, taken_at, sort_order, COALESCE(NULLIF(caption_en,\'\'), caption) AS caption FROM photos WHERE album_id = ? ORDER BY sort_order, id'
    : 'SELECT id, filename, caption, taken_at, sort_order FROM photos WHERE album_id = ? ORDER BY sort_order, id';
  const { results: photos } = await c.env.DB.prepare(photosSql).bind(c.req.param('id')).all();
  return c.json({ ...album, photos });
});

content.get('/diaries', async (c) => {
  const isEn = localized(c) === 'en';
  const page = Math.max(1, Number(c.req.query('page')) || 1);
  const size = 10;
  // 分类筛选：category 为正整数时按分类过滤，非法/空则忽略
  const catRaw = c.req.query('category');
  const catId = catRaw !== undefined && catRaw !== '' ? Number(catRaw) : NaN;
  const categorySql = Number.isInteger(catId) && catId > 0 ? 'AND d.category_id = ?' : '';
  const catArgs = categorySql ? [catId] : [];
  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM diaries d WHERE d.status = 'published' ${categorySql}`
  ).bind(...catArgs).first<{ n: number }>();
  const listSql = isEn
    ? `SELECT d.id, d.slug, d.cover_filename, d.published_at, u.display_name AS author,
              c.id AS category_id, COALESCE(NULLIF(c.name_en,''), c.name) AS category_name,
              COALESCE(NULLIF(d.title_en,''), d.title) AS title,
              substr(COALESCE(NULLIF(d.content_md_en,''), d.content_md), 1, 200) AS excerpt
       FROM diaries d JOIN admin_users u ON u.id = d.author_id
       LEFT JOIN diary_categories c ON c.id = d.category_id
       WHERE d.status = 'published' ${categorySql}
       ORDER BY d.published_at DESC LIMIT ? OFFSET ?`
    : `SELECT d.id, d.title, d.slug, d.cover_filename, d.published_at, u.display_name AS author,
              c.id AS category_id, c.name AS category_name,
              substr(d.content_md, 1, 200) AS excerpt
       FROM diaries d JOIN admin_users u ON u.id = d.author_id
       LEFT JOIN diary_categories c ON c.id = d.category_id
       WHERE d.status = 'published' ${categorySql}
       ORDER BY d.published_at DESC LIMIT ? OFFSET ?`;
  const { results } = await c.env.DB.prepare(listSql).bind(...catArgs, size, (page - 1) * size).all();
  return c.json({ items: results, total: total?.n ?? 0 });
});

// 分类列表（供前台筛选 chips，含已发布日记数）
content.get('/diary-categories', async (c) => {
  const isEn = localized(c) === 'en';
  const sql = isEn
    ? `SELECT c.id, COALESCE(NULLIF(c.name_en,''), c.name) AS name, c.sort_order, COUNT(d.id) AS count
       FROM diary_categories c
       LEFT JOIN diaries d ON d.category_id = c.id AND d.status = 'published'
       GROUP BY c.id ORDER BY c.sort_order, c.id`
    : `SELECT c.id, c.name, c.sort_order, COUNT(d.id) AS count
       FROM diary_categories c
       LEFT JOIN diaries d ON d.category_id = c.id AND d.status = 'published'
       GROUP BY c.id ORDER BY c.sort_order, c.id`;
  const { results } = await c.env.DB.prepare(sql).all();
  return c.json(results);
});

content.get('/diaries/:slugOrId', async (c) => {
  const isEn = localized(c) === 'en';
  const key = c.req.param('slugOrId');
  const isId = /^\d+$/.test(key);
  const sql = isEn
    ? `SELECT d.id, d.slug, d.cover_filename, d.published_at, u.display_name AS author,
              c.id AS category_id, COALESCE(NULLIF(c.name_en,''), c.name) AS category_name,
              COALESCE(NULLIF(d.title_en,''), d.title) AS title,
              COALESCE(NULLIF(d.content_md_en,''), d.content_md) AS content_md
       FROM diaries d JOIN admin_users u ON u.id = d.author_id
       LEFT JOIN diary_categories c ON c.id = d.category_id
       WHERE d.status = 'published' AND ${isId ? 'd.id = ?' : 'd.slug = ?'}`
    : `SELECT d.id, d.title, d.slug, d.content_md, d.cover_filename, d.published_at, u.display_name AS author,
              c.id AS category_id, c.name AS category_name
       FROM diaries d JOIN admin_users u ON u.id = d.author_id
       LEFT JOIN diary_categories c ON c.id = d.category_id
       WHERE d.status = 'published' AND ${isId ? 'd.id = ?' : 'd.slug = ?'}`;
  const d = await c.env.DB.prepare(sql).bind(key).first();
  if (!d) return c.json({ detail: '文章不存在' }, 404);
  return c.json(d);
});

content.get('/music/albums', async (c) => {
  const isEn = localized(c) === 'en';
  const sql = isEn
    ? `SELECT m.id, m.cover_filename, m.year, m.sort_order,
              COALESCE(NULLIF(m.title_en,''), m.title) AS title,
              COUNT(s.id) AS song_count
       FROM music_albums m LEFT JOIN songs s ON s.album_id = m.id
       GROUP BY m.id ORDER BY m.sort_order, m.id`
    : `SELECT m.*, COUNT(s.id) AS song_count FROM music_albums m
       LEFT JOIN songs s ON s.album_id = m.id GROUP BY m.id ORDER BY m.sort_order, m.id`;
  const { results } = await c.env.DB.prepare(sql).all();
  return c.json(results);
});

content.get('/messages', async (c) => {
  const type = c.req.query('target_type') ?? 'site';
  const targetId = c.req.query('target_id');
  const sql = targetId
    ? 'SELECT id, nickname, content, quote_text, created_at FROM messages WHERE is_approved = 1 AND target_type = ? AND target_id = ? ORDER BY id DESC LIMIT 100'
    : 'SELECT id, nickname, content, quote_text, created_at FROM messages WHERE is_approved = 1 AND target_type = ? ORDER BY id DESC LIMIT 100';
  const stmt = targetId
    ? c.env.DB.prepare(sql).bind(type, Number(targetId))
    : c.env.DB.prepare(sql).bind(type);
  return c.json((await stmt.all()).results);
});

content.post('/messages', async (c) => {
  if (!rateLimit({ limit: 10, windowSec: 3600, key: `msg:${clientIp(c.req.raw)}` })) {
    return c.json({ detail: '留言过于频繁，请稍后再试' }, 429);
  }
  const { nickname, content: text, target_type = 'site', target_id = null, quote_text = null } = await c.req.json();
  if (!nickname?.trim() || !text?.trim()) return c.json({ detail: '昵称和内容必填' }, 400);
  if (nickname.length > 20) return c.json({ detail: '昵称过长' }, 400);
  if (text.length > 500) return c.json({ detail: '内容过长（500 字以内）' }, 400);
  if (!['diary', 'photo', 'site'].includes(target_type)) return c.json({ detail: '非法目标类型' }, 400);
  // quote_text 只对日记划线评论有意义；其他目标类型直接忽略（存 NULL），不报错
  const quote = target_type === 'diary' && typeof quote_text === 'string' && quote_text.trim()
    ? quote_text.trim()
    : null;
  if (quote && quote.length > 500) return c.json({ detail: '引用内容过长（500 字以内）' }, 400);
  // 日记评论免审核直接发布；site/photo 保持待审核
  const approved = target_type === 'diary' ? 1 : 0;
  await c.env.DB.prepare('INSERT INTO messages (nickname, content, target_type, target_id, quote_text, is_approved) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(nickname.trim(), text.trim(), target_type, target_id, quote, approved).run();
  return approved
    ? c.json({ detail: '评论已发布' }, 201)
    : c.json({ detail: '留言已提交，待审核' }, 202);
});

content.get('/music/albums/:id', async (c) => {
  const isEn = localized(c) === 'en';
  const albumSql = isEn
    ? 'SELECT id, sort_order, cover_filename, year, COALESCE(NULLIF(title_en,\'\'), title) AS title FROM music_albums WHERE id = ?'
    : 'SELECT * FROM music_albums WHERE id = ?';
  const album = await c.env.DB.prepare(albumSql).bind(c.req.param('id')).first();
  if (!album) return c.json({ detail: '专辑不存在' }, 404);
  const songsSql = isEn
    ? 'SELECT id, track_no, filename, duration, COALESCE(NULLIF(title_en,\'\'), title) AS title FROM songs WHERE album_id = ? ORDER BY track_no, id'
    : 'SELECT id, title, track_no, filename, duration FROM songs WHERE album_id = ? ORDER BY track_no, id';
  const { results: songs } = await c.env.DB.prepare(songsSql).bind(c.req.param('id')).all();
  return c.json({ ...album, songs });
});

pub.route('/', content);
export default pub;
