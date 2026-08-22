import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, registerUser } from './helpers';

beforeAll(applyMigrations);

// 与后端一致：UTC+8 日历日
const dateStr = (offsetDays = 0) =>
  new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * 86400000).toISOString().slice(0, 10);

let user: { id: number; token: string };
const auth = () => ({ Authorization: `Bearer ${user.token}` });

beforeAll(async () => {
  user = await registerUser('checkin_user');
});

async function reset() {
  await env.DB.prepare('DELETE FROM checkins WHERE user_id = ?').bind(user.id).run();
  await env.DB.prepare('DELETE FROM point_transactions WHERE user_id = ?').bind(user.id).run();
  await env.DB.prepare('UPDATE users SET points = 0 WHERE id = ?').bind(user.id).run();
  // 清理可能残留的设置，确保走默认值
  await env.DB.prepare("DELETE FROM settings WHERE key IN ('checkin_base_points','checkin_streak_bonus','checkin_max_points','box_cost','draw_mode')").run();
}

async function checkin() {
  return SELF.fetch('http://x/api/checkin', { method: 'POST', headers: auth() });
}

describe('签到', () => {
  it('未登录 401', async () => {
    const res = await SELF.fetch('http://x/api/checkin', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('首次签到得 10 分，连续第 1 天；重复签到 409', async () => {
    await reset();
    const res = await checkin();
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.points_earned).toBe(10);
    expect(data.streak_day).toBe(1);
    expect(data.balance).toBe(10);

    expect((await checkin()).status).toBe(409);

    const tx = await env.DB.prepare("SELECT * FROM point_transactions WHERE user_id = ? AND type = 'checkin'")
      .bind(user.id).all();
    expect(tx.results).toHaveLength(1);
    expect((tx.results[0] as any).balance_after).toBe(10);
  });

  it('昨天签过 → 连击 +1，得分 15', async () => {
    await reset();
    await env.DB.prepare('INSERT INTO checkins (user_id, checkin_date, streak_day, points_earned) VALUES (?, ?, ?, ?)')
      .bind(user.id, dateStr(-1), 1, 10).run();
    const data = await (await checkin()).json() as any;
    expect(data.streak_day).toBe(2);
    expect(data.points_earned).toBe(15);
  });

  it('连击达到上限后封顶 40', async () => {
    await reset();
    await env.DB.prepare('INSERT INTO checkins (user_id, checkin_date, streak_day, points_earned) VALUES (?, ?, ?, ?)')
      .bind(user.id, dateStr(-1), 10, 40).run();
    const data = await (await checkin()).json() as any;
    expect(data.streak_day).toBe(11);
    expect(data.points_earned).toBe(40);
  });

  it('断签后从第 1 天重新计', async () => {
    await reset();
    await env.DB.prepare('INSERT INTO checkins (user_id, checkin_date, streak_day, points_earned) VALUES (?, ?, ?, ?)')
      .bind(user.id, dateStr(-3), 5, 30).run();
    const data = await (await checkin()).json() as any;
    expect(data.streak_day).toBe(1);
    expect(data.points_earned).toBe(10);
  });

  it('status 返回今日状态/连击/余额/明日可得', async () => {
    await reset();
    let status = await (await SELF.fetch('http://x/api/checkin/status', { headers: auth() })).json() as any;
    expect(status).toMatchObject({ checked_in: false, streak_day: 0, balance: 0, next_points: 10, box_cost: 100 });

    await checkin();
    status = await (await SELF.fetch('http://x/api/checkin/status', { headers: auth() })).json() as any;
    expect(status.checked_in).toBe(true);
    expect(status.streak_day).toBe(1);
    expect(status.balance).toBe(10);
    expect(status.next_points).toBe(15);
  });

  it('status 返回 draw_mode，默认 box，配置 wheel 后生效', async () => {
    await reset();
    let status = await (await SELF.fetch('http://x/api/checkin/status', { headers: auth() })).json() as any;
    expect(status.draw_mode).toBe('box');

    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('draw_mode', 'wheel')").run();
    status = await (await SELF.fetch('http://x/api/checkin/status', { headers: auth() })).json() as any;
    expect(status.draw_mode).toBe('wheel');

    await env.DB.prepare("DELETE FROM settings WHERE key = 'draw_mode'").run();
  });
});
