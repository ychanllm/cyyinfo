import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import type { AppEnv, Env } from '../types';
import { signJwt } from '../auth';
import { enforceRateLimit, clientIp } from '../security';
import { contentGuard, getSetting } from '../guard';
import { logAudit } from '../audit';

const pub = new Hono<AppEnv>();

// 公开内容按 ?lang= 返回对应语言（默认中文），英文为空时回退中文
function localized(c: { req: { query: (k: string) => string | undefined } }): 'en' | 'zh' {
  return c.req.query('lang') === 'en' ? 'en' : 'zh';
}

function parsePagination(c: { req: { query: (k: string) => string | undefined } }, defaultSize: number, maxSize: number) {
  const pageRaw = c.req.query('page');
  const sizeRaw = c.req.query('size');
  const pageValue = Number(pageRaw);
  const sizeValue = Number(sizeRaw);
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const size = Number.isSafeInteger(sizeValue) && sizeValue > 0
    ? Math.min(sizeValue, maxSize)
    : defaultSize;
  return { page, size, offset: (page - 1) * size, requested: pageRaw !== undefined || sizeRaw !== undefined };
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
  if (!await enforceRateLimit(c.env.PASSCODE_RATE_LIMITER, { limit: 5, windowSec: 900, key: `passcode:${clientIp(c.req.raw)}` })) {
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
const content = new Hono<AppEnv>();
content.use('*', contentGuard);
content.get('/albums', async (c) => {
  const isEn = localized(c) === 'en';
  const pagination = parsePagination(c, 12, 50);
  const sql = isEn
    ? `SELECT a.id, a.sort_order, a.created_at, a.cover_photo_id,
              COALESCE(NULLIF(a.title_en,''), a.title) AS title,
              COALESCE(NULLIF(a.description_en,''), a.description) AS description,
              p.filename AS cover_filename
       FROM albums a LEFT JOIN photos p ON p.id = a.cover_photo_id AND p.hidden = 0
       ORDER BY a.sort_order, a.id`
    : 'SELECT a.*, p.filename AS cover_filename FROM albums a LEFT JOIN photos p ON p.id = a.cover_photo_id AND p.hidden = 0 ORDER BY a.sort_order, a.id';
  const query = pagination.requested ? `${sql} LIMIT ? OFFSET ?` : sql;
  const stmt = pagination.requested
    ? c.env.DB.prepare(query).bind(pagination.size, pagination.offset)
    : c.env.DB.prepare(query);
  const { results } = await stmt.all();
  if (!pagination.requested) return c.json(results);
  const total = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM albums').first<{ n: number }>();
  return c.json({ items: results, total: total?.n ?? 0, page: pagination.page, size: pagination.size });
});

content.get('/albums/:id', async (c) => {
  const isEn = localized(c) === 'en';
  const albumSql = isEn
    ? `SELECT a.id, a.sort_order, a.created_at, a.cover_photo_id,
              COALESCE(NULLIF(a.title_en,''), a.title) AS title,
              COALESCE(NULLIF(a.description_en,''), a.description) AS description,
              p.filename AS cover_filename
       FROM albums a LEFT JOIN photos p ON p.id = a.cover_photo_id AND p.hidden = 0 WHERE a.id = ?`
    : 'SELECT a.*, p.filename AS cover_filename FROM albums a LEFT JOIN photos p ON p.id = a.cover_photo_id AND p.hidden = 0 WHERE a.id = ?';
  const album = await c.env.DB.prepare(albumSql).bind(c.req.param('id')).first();
  if (!album) return c.json({ detail: '相册不存在' }, 404);
  // 隐藏的照片前台不展示（R2 文件保留，后台可恢复）
  const photosSql = isEn
    ? 'SELECT id, filename, taken_at, sort_order, COALESCE(NULLIF(caption_en,\'\'), caption) AS caption FROM photos WHERE album_id = ? AND hidden = 0 ORDER BY sort_order, id'
    : 'SELECT id, filename, caption, taken_at, sort_order FROM photos WHERE album_id = ? AND hidden = 0 ORDER BY sort_order, id';
  const { results: photos } = await c.env.DB.prepare(photosSql).bind(c.req.param('id')).all();
  return c.json({ ...album, photos });
});

content.get('/diaries', async (c) => {
  const isEn = localized(c) === 'en';
  const { page, size, offset } = parsePagination(c, 10, 50);
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
  const { results } = await c.env.DB.prepare(listSql).bind(...catArgs, size, offset).all();
  return c.json({ items: results, total: total?.n ?? 0, page, size });
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
  const pagination = parsePagination(c, 12, 50);
  const sql = isEn
    ? `SELECT m.id, m.cover_filename, m.year, m.sort_order,
              COALESCE(NULLIF(m.title_en,''), m.title) AS title,
              COUNT(s.id) AS song_count
       FROM music_albums m LEFT JOIN songs s ON s.album_id = m.id
       GROUP BY m.id ORDER BY m.sort_order, m.id`
    : `SELECT m.*, COUNT(s.id) AS song_count FROM music_albums m
       LEFT JOIN songs s ON s.album_id = m.id GROUP BY m.id ORDER BY m.sort_order, m.id`;
  const query = pagination.requested ? `${sql} LIMIT ? OFFSET ?` : sql;
  const stmt = pagination.requested
    ? c.env.DB.prepare(query).bind(pagination.size, pagination.offset)
    : c.env.DB.prepare(query);
  const { results } = await stmt.all();
  if (!pagination.requested) return c.json(results);
  const total = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM music_albums').first<{ n: number }>();
  return c.json({ items: results, total: total?.n ?? 0, page: pagination.page, size: pagination.size });
});

content.get('/messages', async (c) => {
  const type = c.req.query('target_type') ?? 'site';
  const targetId = c.req.query('target_id');
  const sql = targetId
    ? 'SELECT id, nickname, content, quote_text, parent_id, created_at FROM messages WHERE is_approved = 1 AND target_type = ? AND target_id = ? ORDER BY id DESC LIMIT 100'
    : 'SELECT id, nickname, content, quote_text, parent_id, created_at FROM messages WHERE is_approved = 1 AND target_type = ? ORDER BY id DESC LIMIT 100';
  const stmt = targetId
    ? c.env.DB.prepare(sql).bind(type, Number(targetId))
    : c.env.DB.prepare(sql).bind(type);
  return c.json((await stmt.all()).results);
});

content.post('/messages', async (c) => {
  if (!await enforceRateLimit(c.env.MESSAGE_RATE_LIMITER, { limit: 10, windowSec: 3600, key: `msg:${clientIp(c.req.raw)}` })) {
    return c.json({ detail: '留言过于频繁，请稍后再试' }, 429);
  }
  const { nickname, content: text, target_type = 'site', target_id = null, quote_text = null, parent_id = null } = await c.req.json();
  if (!nickname?.trim() || !text?.trim()) return c.json({ detail: '昵称和内容必填' }, 400);
  if (nickname.length > 20) return c.json({ detail: '昵称过长' }, 400);
  if (text.length > 500) return c.json({ detail: '内容过长（500 字以内）' }, 400);
  if (!['diary', 'photo', 'site'].includes(target_type)) return c.json({ detail: '非法目标类型' }, 400);
  // 楼中楼回复：parent 必须存在且与回复同 target；回复的回复挂到顶级（一层楼中楼）
  let parentId: number | null = null;
  if (parent_id !== null && parent_id !== undefined) {
    if (!Number.isInteger(parent_id) || parent_id <= 0) return c.json({ detail: '非法的父评论' }, 400);
    const parent = await c.env.DB.prepare(
      'SELECT id, target_type, target_id, parent_id FROM messages WHERE id = ?'
    ).bind(parent_id).first<{ id: number; target_type: string; target_id: number | null; parent_id: number | null }>();
    if (!parent) return c.json({ detail: '父评论不存在' }, 400);
    const sameTarget = parent.target_type === target_type
      && (parent.target_id ?? null) === (target_id ?? null);
    if (!sameTarget) return c.json({ detail: '回复目标与父评论不一致' }, 400);
    parentId = parent.parent_id ?? parent.id;
  }
  // quote_text 只对日记划线评论有意义；其他目标类型及楼中楼回复直接忽略（存 NULL），不报错
  const quote = !parentId && target_type === 'diary' && typeof quote_text === 'string' && quote_text.trim()
    ? quote_text.trim()
    : null;
  if (quote && quote.length > 500) return c.json({ detail: '引用内容过长（500 字以内）' }, 400);
  // 日记评论免审核直接发布；site/photo 保持待审核
  const approved = target_type === 'diary' ? 1 : 0;
  await c.env.DB.prepare('INSERT INTO messages (nickname, content, target_type, target_id, quote_text, parent_id, is_approved) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(nickname.trim(), text.trim(), target_type, target_id, quote, parentId, approved).run();
  const targetLabel = target_id ? `${target_type}#${target_id}` : target_type;
  await logAudit(c.env.DB, 'message_post', nickname.trim(), `在 ${targetLabel} 留言：${text.trim().slice(0, 30)}`);
  return approved
    ? c.json({ detail: '评论已发布' }, 201)
    : c.json({ detail: '留言已提交，待审核' }, 202);
});

// 浏览量上报：upsert 自增，前端用 sessionStorage 去重（同一会话同一目标只报一次）
const VIEW_TARGET_TYPES = ['album', 'photo', 'diary'];
content.post('/views', async (c) => {
  const { target_type, target_id } = await c.req.json<{ target_type?: string; target_id?: unknown }>()
    .catch((): { target_type?: string; target_id?: unknown } => ({}));
  const id = typeof target_id === 'string' ? Number(target_id) : target_id;
  if (!target_type || !VIEW_TARGET_TYPES.includes(target_type)) return c.json({ detail: '非法目标类型' }, 400);
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return c.json({ detail: '非法目标 ID' }, 400);
  await c.env.DB.prepare(
    `INSERT INTO view_counts (target_type, target_id, count) VALUES (?, ?, 1)
     ON CONFLICT(target_type, target_id) DO UPDATE SET count = count + 1`
  ).bind(target_type, id).run();
  const row = await c.env.DB.prepare('SELECT count FROM view_counts WHERE target_type = ? AND target_id = ?')
    .bind(target_type, id).first<{ count: number }>();
  return c.json({ views: row?.count ?? 1 });
});

// 排行榜：综合浏览与点赞（score = 赞*5 + 浏览），各取前 10；无浏览无点赞的条目不进榜
const LEADERBOARD_STATS = `
  LEFT JOIN (SELECT target_id, count AS views FROM view_counts WHERE target_type = ?) v ON v.target_id = t.id
  LEFT JOIN (SELECT target_id, COALESCE(SUM(count), 0) AS likes FROM likes WHERE target_type = ? GROUP BY target_id) l ON l.target_id = t.id`;
const LEADERBOARD_TAIL = `
  WHERE COALESCE(v.views, 0) + COALESCE(l.likes, 0) > 0
  ORDER BY score DESC, t.id ASC LIMIT 10`;
content.get('/leaderboard', async (c) => {
  const db = c.env.DB;
  const { results: albums } = await db.prepare(
    `SELECT t.id, t.title, t.title_en,
            COALESCE(v.views, 0) AS views, COALESCE(l.likes, 0) AS likes,
            COALESCE(l.likes, 0) * 5 + COALESCE(v.views, 0) AS score
     FROM albums t ${LEADERBOARD_STATS} ${LEADERBOARD_TAIL}`
  ).bind('album', 'album').all();
  // 照片榜排除已隐藏的
  const { results: photos } = await db.prepare(
    `SELECT t.id, t.album_id, t.filename, t.caption, t.caption_en,
            COALESCE(v.views, 0) AS views, COALESCE(l.likes, 0) AS likes,
            COALESCE(l.likes, 0) * 5 + COALESCE(v.views, 0) AS score
     FROM photos t ${LEADERBOARD_STATS}
     WHERE t.hidden = 0 AND COALESCE(v.views, 0) + COALESCE(l.likes, 0) > 0
     ORDER BY score DESC, t.id ASC LIMIT 10`
  ).bind('photo', 'photo').all();
  // 日记榜只算已发布的；点赞合并该日记下留言(含楼中楼回复)的赞；带 slug 供前端跳转
  const { results: diaries } = await db.prepare(
    `SELECT t.id, t.title, t.title_en, t.slug,
            COALESCE(v.views, 0) AS views,
            COALESCE(l.likes, 0) + COALESCE(ml.msg_likes, 0) AS likes,
            (COALESCE(l.likes, 0) + COALESCE(ml.msg_likes, 0)) * 5 + COALESCE(v.views, 0) AS score
     FROM diaries t ${LEADERBOARD_STATS}
     LEFT JOIN (
       SELECT m.target_id AS diary_id, COALESCE(SUM(l2.count), 0) AS msg_likes
       FROM messages m
       JOIN likes l2 ON l2.target_type = 'message' AND l2.target_id = m.id
       WHERE m.target_type = 'diary'
       GROUP BY m.target_id
     ) ml ON ml.diary_id = t.id
     WHERE t.status = 'published'
       AND COALESCE(v.views, 0) + COALESCE(l.likes, 0) + COALESCE(ml.msg_likes, 0) > 0
     ORDER BY score DESC, t.id ASC LIMIT 10`
  ).bind('diary', 'diary').all();
  return c.json({ albums, photos, diaries });
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
