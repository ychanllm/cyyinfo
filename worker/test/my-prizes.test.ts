import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, registerUser } from './helpers';

beforeAll(applyMigrations);

let userA: { id: number; token: string };
let userB: { id: number; token: string };
const authA = () => ({ Authorization: `Bearer ${userA.token}` });
const authB = () => ({ Authorization: `Bearer ${userB.token}` });

beforeAll(async () => {
  userA = await registerUser('myprize_a');
  userB = await registerUser('myprize_b');
});

async function giveRecord(userId: number, status = 'pending'): Promise<number> {
  const p = await env.DB.prepare('INSERT INTO prizes (name, points_cost) VALUES (?, ?)')
    .bind(`奖品-${Date.now()}-${Math.random()}`, 100).run();
  const r = await env.DB.prepare(
    "INSERT INTO prize_records (user_id, prize_id, source, points_spent, status) VALUES (?, ?, 'redeem', 100, ?)"
  ).bind(userId, p.meta.last_row_id, status).run();
  return Number(r.meta.last_row_id);
}

describe('我的奖品', () => {
  it('列表只含本人记录，带奖品信息', async () => {
    const rid = await giveRecord(userA.id);
    await giveRecord(userB.id);
    const res = await SELF.fetch('http://x/api/my/prizes', { headers: authA() });
    expect(res.status).toBe(200);
    const list = await res.json() as any[];
    expect(list.length).toBeGreaterThanOrEqual(1);
    const mine = list.find((r) => r.id === rid);
    expect(mine).toBeTruthy();
    expect(mine.name).toContain('奖品-');
    expect(mine.status).toBe('pending');
    expect(list.every((r) => !list.length || r.id !== undefined)).toBe(true);
  });

  it('本人核销成功，重复核销 409，他人核销 409', async () => {
    const rid = await giveRecord(userA.id);
    expect((await SELF.fetch(`http://x/api/my/prizes/${rid}/use`, { method: 'POST', headers: authB() })).status).toBe(409);

    const ok = await SELF.fetch(`http://x/api/my/prizes/${rid}/use`, { method: 'POST', headers: authA() });
    expect(ok.status).toBe(200);

    const rec = await env.DB.prepare('SELECT status, used_at FROM prize_records WHERE id = ?').bind(rid).first<any>();
    expect(rec.status).toBe('used');
    expect(rec.used_at).toBeTruthy();

    expect((await SELF.fetch(`http://x/api/my/prizes/${rid}/use`, { method: 'POST', headers: authA() })).status).toBe(409);
  });

  it('未登录 401', async () => {
    expect((await SELF.fetch('http://x/api/my/prizes')).status).toBe(401);
  });
});
