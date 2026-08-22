import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, adminToken, registerUser } from './helpers';

beforeAll(applyMigrations);

const json = { 'Content-Type': 'application/json' };
let user: { id: number; token: string };
const adminH = async () => ({ Authorization: `Bearer ${await adminToken()}` });

beforeAll(async () => {
  user = await registerUser('site_admin_view_user');
});

describe('管理端注册用户管理', () => {
  it('未带管理员 token 401', async () => {
    expect((await SELF.fetch('http://x/api/admin/site-users')).status).toBe(401);
    expect((await SELF.fetch(`http://x/api/admin/site-users/${user.id}/checkins`)).status).toBe(401);
  });

  it('列出注册用户（含用户名/积分/创建时间，不泄露密码哈希）', async () => {
    const res = await SELF.fetch('http://x/api/admin/site-users', { headers: await adminH() });
    expect(res.status).toBe(200);
    const list = (await res.json()) as any[];
    const row = list.find((u) => u.id === user.id);
    expect(row).toBeTruthy();
    expect(row.username).toBe('site_admin_view_user');
    expect(row.points).toBe(0);
    expect(row.created_at).toBeTruthy();
    expect(row.password_hash).toBeUndefined();
  });

  it('重置密码：短密码 400、用户不存在 404、成功后旧密码失效新密码可登录', async () => {
    const headers = { ...(await adminH()), ...json };

    const short = await SELF.fetch(`http://x/api/admin/site-users/${user.id}`, {
      method: 'PUT', headers, body: JSON.stringify({ password: '12345' }),
    });
    expect(short.status).toBe(400);

    const missing = await SELF.fetch('http://x/api/admin/site-users/999999', {
      method: 'PUT', headers, body: JSON.stringify({ password: 'newpass6' }),
    });
    expect(missing.status).toBe(404);

    const ok = await SELF.fetch(`http://x/api/admin/site-users/${user.id}`, {
      method: 'PUT', headers, body: JSON.stringify({ password: 'newpass6' }),
    });
    expect(ok.status).toBe(200);

    const badLogin = await SELF.fetch('http://x/api/auth/login', {
      method: 'POST', headers: json,
      body: JSON.stringify({ username: 'site_admin_view_user', password: 'secret6' }),
    });
    expect(badLogin.status).toBe(401);

    const goodLogin = await SELF.fetch('http://x/api/auth/login', {
      method: 'POST', headers: json,
      body: JSON.stringify({ username: 'site_admin_view_user', password: 'newpass6' }),
    });
    expect(goodLogin.status).toBe(200);
  });

  it('签到记录与积分明细', async () => {
    // 固定签到配置，保证得分确定；签到一次产生 checkin 记录和 checkin 流水
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('checkin_base_points', '10')").run();
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('checkin_streak_bonus', '5')").run();
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('checkin_max_points', '40')").run();
    await env.DB.prepare('DELETE FROM checkins WHERE user_id = ?').bind(user.id).run();
    await env.DB.prepare('DELETE FROM point_transactions WHERE user_id = ?').bind(user.id).run();
    await env.DB.prepare('UPDATE users SET points = 0 WHERE id = ?').bind(user.id).run();

    const res = await SELF.fetch('http://x/api/checkin', {
      method: 'POST', headers: { Authorization: `Bearer ${user.token}` },
    });
    expect(res.status).toBe(200);

    const headers = await adminH();
    const checkins = (await (
      await SELF.fetch(`http://x/api/admin/site-users/${user.id}/checkins`, { headers })
    ).json()) as any[];
    expect(checkins).toHaveLength(1);
    expect(checkins[0].streak_day).toBe(1);
    expect(checkins[0].points_earned).toBe(10);
    expect(checkins[0].checkin_date).toBeTruthy();

    const txs = (await (
      await SELF.fetch(`http://x/api/admin/site-users/${user.id}/point-transactions`, { headers })
    ).json()) as any[];
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ type: 'checkin', change: 10, balance_after: 10 });
    expect(txs[0].prize_name).toBeNull();

    await env.DB.prepare("DELETE FROM settings WHERE key IN ('checkin_base_points','checkin_streak_bonus','checkin_max_points')").run();
  });

  it('兑换产生 redeem 流水且联出奖品名', async () => {
    const pid = Number((await env.DB.prepare(
      "INSERT INTO prizes (name, name_en, points_cost, stock) VALUES ('测试奖品', 'Test Prize', 30, -1)"
    ).run()).meta.last_row_id);
    await env.DB.prepare('UPDATE users SET points = 100 WHERE id = ?').bind(user.id).run();

    const res = await SELF.fetch(`http://x/api/prizes/${pid}/redeem`, {
      method: 'POST', headers: { Authorization: `Bearer ${user.token}` },
    });
    expect(res.status).toBe(200);

    const txs = (await (
      await SELF.fetch(`http://x/api/admin/site-users/${user.id}/point-transactions`, { headers: await adminH() })
    ).json()) as any[];
    const redeemTx = txs.find((t) => t.type === 'redeem');
    expect(redeemTx).toBeTruthy();
    expect(redeemTx.change).toBe(-30);
    expect(redeemTx.balance_after).toBe(70);
    expect(redeemTx.prize_name).toBe('测试奖品');
    expect(redeemTx.prize_name_en).toBe('Test Prize');

    // 清理：先删引用奖品的记录再删奖品（外键约束）
    await env.DB.prepare('DELETE FROM prize_records WHERE user_id = ?').bind(user.id).run();
    await env.DB.prepare('DELETE FROM prizes WHERE id = ?').bind(pid).run();
  });

  it('不存在的用户查签到/流水返回 404', async () => {
    const headers = await adminH();
    expect((await SELF.fetch('http://x/api/admin/site-users/999999/checkins', { headers })).status).toBe(404);
    expect((await SELF.fetch('http://x/api/admin/site-users/999999/point-transactions', { headers })).status).toBe(404);
  });
});
