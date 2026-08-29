import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { applyMigrations, adminToken, registerUser } from './helpers';

// 用专有的「榜测」数据断言，避免与其他测试文件共享 D1 的数据互相干扰
let user: { id: number; token: string };
let albumA = 0; let albumB = 0; let albumIdle = 0;
let photoA = 0; let photoB = 0; let photoHidden = 0;
let diary1 = 0; let diary2 = 0; let diaryDraft = 0;
let msg1 = 0; let msg2 = 0;

const postView = (target_type: string, target_id: unknown) =>
  SELF.fetch('http://x/api/views', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_type, target_id }),
  });

const toggleLike = (target_type: string, target_id: number) =>
  SELF.fetch('http://x/api/likes/toggle', {
    method: 'POST',
    headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_type, target_id }),
  });

beforeAll(async () => {
  await applyMigrations();
  await adminToken(); // 首次登录会自动创建 admin_users 记录（diaries.author_id 外键）
  user = await registerUser('lb_user');

  const a1 = await env.DB.prepare("INSERT INTO albums (title, title_en) VALUES ('榜测相册甲', 'LB Album A')").run();
  albumA = Number(a1.meta.last_row_id);
  const a2 = await env.DB.prepare("INSERT INTO albums (title) VALUES ('榜测相册乙')").run();
  albumB = Number(a2.meta.last_row_id);
  const a3 = await env.DB.prepare("INSERT INTO albums (title) VALUES ('榜测闲置相册')").run();
  albumIdle = Number(a3.meta.last_row_id);

  const p1 = await env.DB.prepare("INSERT INTO photos (album_id, filename, caption, caption_en) VALUES (?, 'lb/a.jpg', '榜测照片甲', 'LB Photo A')").bind(albumA).run();
  photoA = Number(p1.meta.last_row_id);
  const p2 = await env.DB.prepare("INSERT INTO photos (album_id, filename, caption) VALUES (?, 'lb/b.jpg', '榜测照片乙')").bind(albumA).run();
  photoB = Number(p2.meta.last_row_id);

  // 隐藏照片:有浏览有点赞,但相册榜不应并入
  const p3 = await env.DB.prepare("INSERT INTO photos (album_id, filename, caption, hidden) VALUES (?, 'lb/hidden.jpg', '榜测隐藏照片', 1)").bind(albumA).run();
  photoHidden = Number(p3.meta.last_row_id);

  const d1 = await env.DB.prepare(
    "INSERT INTO diaries (author_id, title, title_en, slug, status, published_at) VALUES (1, '榜测日记一', 'LB Diary One', 'lb-diary-1', 'published', datetime('now'))"
  ).run();
  diary1 = Number(d1.meta.last_row_id);
  const d2 = await env.DB.prepare(
    "INSERT INTO diaries (author_id, title, slug, status, published_at) VALUES (1, '榜测日记二', 'lb-diary-2', 'published', datetime('now'))"
  ).run();
  diary2 = Number(d2.meta.last_row_id);
  const d3 = await env.DB.prepare(
    "INSERT INTO diaries (author_id, title, slug, status) VALUES (1, '榜测草稿', 'lb-diary-draft', 'draft')"
  ).run();
  diaryDraft = Number(d3.meta.last_row_id);

  // 浏览：相册甲 1 次；照片甲 2 次、照片乙 1 次；日记一 3 次、日记二 1 次；草稿 5 次（不应上榜）
  await postView('album', albumA);
  await postView('photo', photoA);
  await postView('photo', photoA);
  await postView('photo', photoB);
  await postView('photo', photoHidden);
  await postView('photo', photoHidden);
  await postView('diary', diary1);
  await postView('diary', diary1);
  await postView('diary', diary1);
  await postView('diary', diary2);
  for (let i = 0; i < 5; i++) await postView('diary', diaryDraft);

  // 点赞：相册乙 1 赞（score 5 > 相册甲 1）；照片乙 1 赞（score 6 > 照片甲 2）；日记一 1 赞（score 8）
  await toggleLike('album', albumB);
  await toggleLike('photo', photoB);
  await toggleLike('photo', photoHidden);
  await toggleLike('diary', diary1);

  // 日记二下造一条留言和一条楼中楼回复,各 1 赞:合并后日记二 likes=2、score=2*5+1=11,超过日记一(8)
  const m1 = await env.DB.prepare(
    "INSERT INTO messages (nickname, content, target_type, target_id, is_approved) VALUES ('榜测留言', 'x', 'diary', ?, 1)"
  ).bind(diary2).run();
  msg1 = Number(m1.meta.last_row_id);
  const m2 = await env.DB.prepare(
    "INSERT INTO messages (nickname, content, target_type, target_id, parent_id, is_approved) VALUES ('榜测回复', 'x', 'diary', ?, ?, 1)"
  ).bind(diary2, msg1).run();
  msg2 = Number(m2.meta.last_row_id);
  await toggleLike('message', msg1);
  await toggleLike('message', msg2);
});

// 测试共享同一 D1：清理本文件的造数，避免影响其它文件的公开列表计数断言
afterAll(async () => {
  const ids = [albumA, albumB, albumIdle];
  await env.DB.prepare(`DELETE FROM diaries WHERE id IN (${diary1}, ${diary2}, ${diaryDraft})`).run();
  await env.DB.prepare(`DELETE FROM albums WHERE id IN (${ids.join(',')})`).run(); // photos 随 CASCADE 删除
  const targets: [string, number][] = [
    ['album', albumA], ['album', albumB], ['album', albumIdle],
    ['photo', photoA], ['photo', photoB], ['photo', photoHidden],
    ['diary', diary1], ['diary', diary2], ['diary', diaryDraft],
  ];
  for (const [type, id] of targets) {
    await env.DB.prepare('DELETE FROM view_counts WHERE target_type = ? AND target_id = ?').bind(type, id).run();
    await env.DB.prepare('DELETE FROM likes WHERE target_type = ? AND target_id = ?').bind(type, id).run();
  }
  await env.DB.prepare(`DELETE FROM messages WHERE id IN (${msg1}, ${msg2})`).run();
  await env.DB.prepare("DELETE FROM likes WHERE target_type = 'message' AND target_id IN (?, ?)").bind(msg1, msg2).run();
});

describe('浏览量上报', () => {
  it('POST /api/views 自增并返回当前计数', async () => {
    const res = await postView('album', albumB);
    expect(res.status).toBe(200);
    const first = (await res.json()) as any;
    expect(first.views).toBeGreaterThanOrEqual(1);

    const again = (await postView('album', albumB)).status;
    expect(again).toBe(200);
    const row = await env.DB.prepare('SELECT count FROM view_counts WHERE target_type = ? AND target_id = ?')
      .bind('album', albumB).first<{ count: number }>();
    expect(row!.count).toBe(first.views + 1);
  });

  it('非法参数返回 400', async () => {
    expect((await postView('song', 1)).status).toBe(400);
    expect((await postView('message', 1)).status).toBe(400);
    expect((await postView('diary', 0)).status).toBe(400);
    expect((await postView('diary', -3)).status).toBe(400);
    expect((await postView('diary', 1.5)).status).toBe(400);
    expect((await postView('diary', 'abc')).status).toBe(400);
    expect((await postView('diary', undefined)).status).toBe(400);
  });

  it('字符串数字 id 也接受', async () => {
    expect((await postView('album', String(albumB))).status).toBe(200);
  });
});

describe('排行榜', () => {
  it('相册榜：照片(非隐藏)的赞和浏览并入相册合计,hidden 照片排除', async () => {
    const res = await SELF.fetch('http://x/api/leaderboard');
    expect(res.status).toBe(200);
    const board = (await res.json()) as any;
    const albums = board.albums.filter((x: any) => [albumA, albumB, albumIdle].includes(x.id));

    // 相册甲:自身 0 赞 + 照片乙 1 赞 = 1 赞(隐藏照片的 1 赞排除);
    // 自身 1 浏览 + 照片甲 2 + 照片乙 1 = 4 浏览(隐藏照片的 2 浏览排除);score = 1*5+4 = 9
    const aa = albums.find((x: any) => x.id === albumA);
    expect(aa.likes).toBe(1);
    expect(aa.views).toBe(4);
    expect(aa.score).toBe(9);
    expect(aa.title).toBe('榜测相册甲');
    expect(aa.title_en).toBe('LB Album A');

    // 相册乙:自身 1 赞,无照片;views ≥ 1(「浏览量上报」用例会再加,不断言精确值)
    const ab = albums.find((x: any) => x.id === albumB);
    expect(ab.likes).toBe(1);
    expect(ab.views).toBeGreaterThanOrEqual(1);
    expect(ab.score).toBe(ab.likes * 5 + ab.views);

    // 相册甲 9 分,相册乙 5+views(浏览量上报会再加 3 次 → 最高 8 分),甲排乙前;闲置相册不上榜
    expect(albums.map((x: any) => x.id)).toEqual([albumA, albumB]);
    expect(board.albums.some((x: any) => x.id === albumIdle)).toBe(false);
  });

  it('照片榜：照片乙（1 赞 1 浏览 = 6）排在照片甲（2 浏览 = 2）前', async () => {
    const board = (await (await SELF.fetch('http://x/api/leaderboard')).json()) as any;
    const photos = board.photos.filter((x: any) => [photoA, photoB].includes(x.id));
    expect(photos.map((x: any) => x.id)).toEqual([photoB, photoA]);
    const pb = photos[0];
    expect(pb.likes).toBe(1);
    expect(pb.views).toBe(1);
    expect(pb.score).toBe(6);
    expect(pb.album_id).toBe(albumA);
    expect(pb.filename).toBe('lb/b.jpg');
    const pa = photos[1];
    expect(pa.views).toBe(2);
    expect(pa.score).toBe(2);
    expect(pa.caption_en).toBe('LB Photo A');
  });

  it('日记榜：留言(含回复)的赞合并进日记点赞，草稿不上榜', async () => {
    const board = await (await SELF.fetch('http://x/api/leaderboard')).json() as any;
    const diaries = board.diaries.filter((x: any) => [diary1, diary2, diaryDraft].includes(x.id));
    // 日记二:0 自身赞 + 2 留言赞 + 1 浏览 = score 11;日记一:1 赞 + 3 浏览 = score 8
    expect(diaries.map((x: any) => x.id)).toEqual([diary2, diary1]);
    const d2 = diaries[0];
    expect(d2.likes).toBe(2);
    expect(d2.views).toBe(1);
    expect(d2.score).toBe(11);
    const d1 = diaries[1];
    expect(d1.slug).toBe('lb-diary-1');
    expect(d1.views).toBe(3);
    expect(d1.likes).toBe(1);
    expect(d1.score).toBe(8);
    expect(board.diaries.some((x: any) => x.id === diaryDraft)).toBe(false);
  });

  it('无浏览无点赞的条目不出现', async () => {
    const board = (await (await SELF.fetch('http://x/api/leaderboard')).json()) as any;
    expect(board.albums.some((x: any) => x.id === albumIdle)).toBe(false);
  });
});

describe('探店榜与点菜榜', () => {
  let storeA = 0; let storeB = 0; let dishA = 0; let dishB = 0;

  beforeAll(async () => {
    const s1 = await env.DB.prepare("INSERT INTO stores (name, is_active) VALUES ('榜测店铺甲', 1)").run();
    storeA = Number(s1.meta.last_row_id);
    const s2 = await env.DB.prepare("INSERT INTO stores (name, is_active) VALUES ('榜测店铺乙', 1)").run();
    storeB = Number(s2.meta.last_row_id);
    const d1 = await env.DB.prepare("INSERT INTO dishes (name, is_active) VALUES ('榜测菜甲', 1)").run();
    dishA = Number(d1.meta.last_row_id);
    const d2 = await env.DB.prepare("INSERT INTO dishes (name, is_active) VALUES ('榜测菜乙', 1)").run();
    dishB = Number(d2.meta.last_row_id);
    // 店铺甲 2 赞（user + 另一个用户），店铺乙 1 赞；菜甲 2 想吃，菜乙 1 想吃
    const other = await registerUser('lb_user2');
    await toggleLike('store', storeA);
    await SELF.fetch('http://x/api/likes/toggle', {
      method: 'POST',
      headers: { Authorization: `Bearer ${other.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_type: 'store', target_id: storeA }),
    });
    await toggleLike('store', storeB);
    await env.DB.prepare('INSERT INTO dish_wants (user_id, dish_id) VALUES (?, ?), (?, ?), (?, ?)')
      .bind(user.id, dishA, other.id, dishA, user.id, dishB).run();
  });

  afterAll(async () => {
    await env.DB.prepare("DELETE FROM notifications WHERE type = 'like' AND target_type = 'store'").run();
    await env.DB.prepare("DELETE FROM likes WHERE target_type = 'store'").run();
    await env.DB.prepare('DELETE FROM dish_wants WHERE dish_id IN (?, ?)').bind(dishA, dishB).run();
    await env.DB.prepare('DELETE FROM dishes WHERE id IN (?, ?)').bind(dishA, dishB).run();
    await env.DB.prepare('DELETE FROM stores WHERE id IN (?, ?)').bind(storeA, storeB).run();
  });

  it('探店榜按赞数排序，无赞不进榜；点菜榜按想吃数排序', async () => {
    const res = await SELF.fetch('http://x/api/leaderboard');
    expect(res.status).toBe(200);
    const data = await res.json() as any;

    const stores = data.stores as any[];
    const sa = stores.find((s) => s.id === storeA);
    const sb = stores.find((s) => s.id === storeB);
    expect(sa).toMatchObject({ name: '榜测店铺甲', likes: 2, score: 10 });
    expect(sb).toMatchObject({ name: '榜测店铺乙', likes: 1, score: 5 });
    expect(stores.indexOf(sa)).toBeLessThan(stores.indexOf(sb));

    const dishes = data.dishes as any[];
    const da = dishes.find((d) => d.id === dishA);
    const db_ = dishes.find((d) => d.id === dishB);
    expect(da).toMatchObject({ name: '榜测菜甲', wants: 2 });
    expect(db_).toMatchObject({ name: '榜测菜乙', wants: 1 });
    expect(dishes.indexOf(da)).toBeLessThan(dishes.indexOf(db_));
  });

  it('下架的店/菜不进榜', async () => {
    await env.DB.prepare('UPDATE stores SET is_active = 0 WHERE id = ?').bind(storeB).run();
    await env.DB.prepare('UPDATE dishes SET is_active = 0 WHERE id = ?').bind(dishB).run();
    const data = await (await SELF.fetch('http://x/api/leaderboard')).json() as any;
    expect((data.stores as any[]).find((s) => s.id === storeB)).toBeUndefined();
    expect((data.dishes as any[]).find((d) => d.id === dishB)).toBeUndefined();
    await env.DB.prepare('UPDATE stores SET is_active = 1 WHERE id = ?').bind(storeB).run();
    await env.DB.prepare('UPDATE dishes SET is_active = 1 WHERE id = ?').bind(dishB).run();
  });
});
