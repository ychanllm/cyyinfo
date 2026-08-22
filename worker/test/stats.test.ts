import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, adminToken, registerUser } from './helpers';

let token: string;
const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  await applyMigrations();
  token = await adminToken();
});

describe('后台统计', () => {
  it('未授权 401', async () => {
    const res = await SELF.fetch('http://x/api/admin/stats');
    expect(res.status).toBe(401);
  });

  it('返回 overview 与 users 汇总，数值与手工构造一致', async () => {
    const u = await registerUser('stats_user1');
    // 手工造数据：2 次签到、1 个赞（count=3）、7 次浏览
    await env.DB.prepare("INSERT INTO checkins (user_id, checkin_date, streak_day, points_earned) VALUES (?, '2026-08-21', 1, 10), (?, '2026-08-22', 2, 20)")
      .bind(u.id, u.id).run();
    await env.DB.prepare("INSERT INTO likes (user_id, target_type, target_id, count) VALUES (?, 'diary', 9200, 3)")
      .bind(u.id).run();
    await env.DB.prepare("INSERT INTO view_counts (target_type, target_id, count) VALUES ('diary', 9200, 7) ON CONFLICT(target_type, target_id) DO UPDATE SET count = count + 7")
      .run();

    const res = await SELF.fetch('http://x/api/admin/stats', { headers: auth() });
    expect(res.status).toBe(200);
    const data = await res.json() as any;

    expect(data.overview).toMatchObject({
      users: expect.any(Number),
      likes: expect.any(Number),
      views: expect.any(Number),
      messages: expect.any(Number),
      photos: expect.any(Number),
      albums: expect.any(Number),
      diaries: expect.any(Number),
    });

    const row = data.users.find((r: any) => r.id === u.id);
    expect(row).toBeTruthy();
    expect(row.username).toBe('stats_user1');
    expect(row.checkins).toBe(2);
    expect(row.likes).toBe(3);
    expect(row.points).toBe(0);

    // overview 聚合包含刚造的数据
    expect(data.overview.likes).toBeGreaterThanOrEqual(3);
    expect(data.overview.views).toBeGreaterThanOrEqual(7);

    await env.DB.prepare('DELETE FROM likes WHERE target_id = 9200').run();
    await env.DB.prepare('DELETE FROM view_counts WHERE target_id = 9200').run();
  });
});
