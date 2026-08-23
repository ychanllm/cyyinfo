import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, adminToken, registerUser } from './helpers';

beforeAll(applyMigrations);

const json = { 'Content-Type': 'application/json' };
const adminH = async () => ({ Authorization: `Bearer ${await adminToken()}` });

// 最小合法 JPEG 字节
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

async function auditLogs(): Promise<any[]> {
  const res = await SELF.fetch('http://x/api/admin/audit-logs', { headers: await adminH() });
  expect(res.status).toBe(200);
  return (await res.json()) as any[];
}

describe('管理端变更日志', () => {
  it('未带管理员 token 401', async () => {
    expect((await SELF.fetch('http://x/api/admin/changelogs')).status).toBe(401);
    expect((await SELF.fetch('http://x/api/admin/audit-logs')).status).toBe(401);
    expect((await SELF.fetch('http://x/api/admin/changelogs', { method: 'POST', headers: json, body: '{}' })).status).toBe(401);
    expect((await SELF.fetch('http://x/api/admin/changelogs/1', { method: 'DELETE' })).status).toBe(401);
  });

  it('changelogs 增删改查，倒序展示', async () => {
    const headers = { ...(await adminH()), ...json };

    const emptyVersion = await SELF.fetch('http://x/api/admin/changelogs', {
      method: 'POST', headers, body: JSON.stringify({ version: '  ' }),
    });
    expect(emptyVersion.status).toBe(400);

    const c1 = await SELF.fetch('http://x/api/admin/changelogs', {
      method: 'POST', headers, body: JSON.stringify({ version: '1.0.0', content: '首个版本' }),
    });
    expect(c1.status).toBe(200);
    const { id: id1 } = (await c1.json()) as any;
    expect(id1).toBeTruthy();

    const c2 = await SELF.fetch('http://x/api/admin/changelogs', {
      method: 'POST', headers, body: JSON.stringify({ version: '1.1.0', content: '新增日志页' }),
    });
    const { id: id2 } = (await c2.json()) as any;

    const list = (await (
      await SELF.fetch('http://x/api/admin/changelogs', { headers: await adminH() })
    ).json()) as any[];
    // 倒序：后建的在前
    expect(list[0].id).toBe(id2);
    expect(list[1].id).toBe(id1);
    expect(list[0].version).toBe('1.1.0');
    expect(list[0].created_at).toBeTruthy();

    const up = await SELF.fetch(`http://x/api/admin/changelogs/${id1}`, {
      method: 'PUT', headers, body: JSON.stringify({ version: '1.0.1', content: '修正文案' }),
    });
    expect(up.status).toBe(200);

    const missing = await SELF.fetch('http://x/api/admin/changelogs/999999', {
      method: 'PUT', headers, body: JSON.stringify({ version: '9.9.9' }),
    });
    expect(missing.status).toBe(404);

    const afterUp = (await (
      await SELF.fetch('http://x/api/admin/changelogs', { headers: await adminH() })
    ).json()) as any[];
    const edited = afterUp.find((r) => r.id === id1);
    expect(edited.version).toBe('1.0.1');
    expect(edited.content).toBe('修正文案');

    const del = await SELF.fetch(`http://x/api/admin/changelogs/${id1}`, { method: 'DELETE', headers: await adminH() });
    expect(del.status).toBe(200);
    const afterDel = (await (
      await SELF.fetch('http://x/api/admin/changelogs', { headers: await adminH() })
    ).json()) as any[];
    expect(afterDel.find((r) => r.id === id1)).toBeUndefined();

    // 清理
    await SELF.fetch(`http://x/api/admin/changelogs/${id2}`, { method: 'DELETE', headers: await adminH() });
  });

  it('注册成功自动写入 user_register 审计日志', async () => {
    await registerUser('audit_reg_user');
    const logs = await auditLogs();
    const log = logs.find((l) => l.type === 'user_register' && l.actor === 'audit_reg_user');
    expect(log).toBeTruthy();
    expect(log.detail).toContain('audit_reg_user');
    expect(log.created_at).toBeTruthy();
  });

  it('更换头像自动写入 avatar_update 审计日志', async () => {
    const { token } = await registerUser('audit_avatar_user');
    const form = new FormData();
    form.append('file', new File([jpeg], 'a.jpg', { type: 'image/jpeg' }));
    const up = await SELF.fetch('http://x/api/users/me/avatar', {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    expect(up.status).toBe(200);
    const logs = await auditLogs();
    expect(logs.find((l) => l.type === 'avatar_update' && l.actor === 'audit_avatar_user')).toBeTruthy();
  });

  it('管理员重置密码自动写入 password_reset 审计日志', async () => {
    const { id } = await registerUser('audit_reset_user');
    const res = await SELF.fetch(`http://x/api/admin/site-users/${id}`, {
      method: 'PUT', headers: { ...(await adminH()), ...json },
      body: JSON.stringify({ password: 'newpass6' }),
    });
    expect(res.status).toBe(200);
    const logs = await auditLogs();
    const log = logs.find((l) => l.type === 'password_reset' && l.detail?.includes('audit_reset_user'));
    expect(log).toBeTruthy();
    expect(log.actor).toBe('admin');
  });

  it('管理员新增/删除账号自动写入 user_create / user_delete 审计日志', async () => {
    const headers = { ...(await adminH()), ...json };
    const create = await SELF.fetch('http://x/api/admin/users', {
      method: 'POST', headers, body: JSON.stringify({ username: 'audit_admin2', password: 'password8' }),
    });
    expect(create.status).toBe(200);
    const { id } = (await create.json()) as any;

    const del = await SELF.fetch(`http://x/api/admin/users/${id}`, { method: 'DELETE', headers: await adminH() });
    expect(del.status).toBe(200);

    const logs = await auditLogs();
    expect(logs.find((l) => l.type === 'user_create' && l.detail?.includes('audit_admin2'))).toBeTruthy();
    expect(logs.find((l) => l.type === 'user_delete' && l.detail?.includes('audit_admin2'))).toBeTruthy();
  });

  it('用户登录自动写入 user_login 审计日志', async () => {
    await registerUser('audit_login_user');
    const res = await SELF.fetch('http://x/api/auth/login', {
      method: 'POST', headers: json,
      body: JSON.stringify({ username: 'audit_login_user', password: 'secret6' }),
    });
    expect(res.status).toBe(200);
    const logs = await SELF.fetch('http://x/api/admin/audit-logs?type=user_login', { headers: await adminH() });
    const list = (await logs.json()) as any[];
    expect(list.find((l) => l.actor === 'audit_login_user')).toBeTruthy();
  });

  it('点赞/连赞自动写入 like / like_burst 审计日志', async () => {
    const u = await registerUser('audit_like_user');
    const h = { Authorization: `Bearer ${u.token}`, ...json };
    const t = await SELF.fetch('http://x/api/likes/toggle', {
      method: 'POST', headers: h, body: JSON.stringify({ target_type: 'diary', target_id: 9300 }),
    });
    expect(t.status).toBe(200);
    const b = await SELF.fetch('http://x/api/likes/burst', {
      method: 'POST', headers: h, body: JSON.stringify({ target_type: 'diary', target_id: 9300, delta: 3 }),
    });
    expect(b.status).toBe(200);

    const likes = await (await SELF.fetch('http://x/api/admin/audit-logs?type=like', { headers: await adminH() })).json() as any[];
    expect(likes.find((l) => l.actor === 'audit_like_user' && l.detail?.includes('diary#9300'))).toBeTruthy();
    const bursts = await (await SELF.fetch('http://x/api/admin/audit-logs?type=like_burst', { headers: await adminH() })).json() as any[];
    expect(bursts.find((l) => l.actor === 'audit_like_user' && l.detail?.includes('+3'))).toBeTruthy();

    await SELF.fetch('http://x/api/likes/toggle', {
      method: 'POST', headers: h, body: JSON.stringify({ target_type: 'diary', target_id: 9300 }),
    });
    const unlikes = await (await SELF.fetch('http://x/api/admin/audit-logs?type=unlike', { headers: await adminH() })).json() as any[];
    expect(unlikes.find((l) => l.actor === 'audit_like_user')).toBeTruthy();
  });

  it('audit-logs 默认 50 条倒序，支持 type 筛选与 offset 分页', async () => {
    // 直接灌入 110 条，验证默认 LIMIT 50
    const stmts = Array.from({ length: 110 }, (_, i) =>
      env.DB.prepare('INSERT INTO audit_logs (type, actor, detail) VALUES (?, ?, ?)')
        .bind('bulk_test', 'tester', `bulk ${i}`));
    await env.DB.batch(stmts);
    const logs = await auditLogs();
    expect(logs.length).toBe(50);
    for (let i = 1; i < logs.length; i++) expect(logs[i - 1].id).toBeGreaterThan(logs[i].id);

    // type 筛选：只返回指定类型
    const filtered = await SELF.fetch('http://x/api/admin/audit-logs?type=bulk_test', { headers: await adminH() });
    const filteredLogs = (await filtered.json()) as any[];
    expect(filteredLogs.length).toBe(50);
    expect(filteredLogs.every((l) => l.type === 'bulk_test')).toBe(true);

    // offset 分页：第二页与第一页不重叠，且能翻到尾（110 条 → 第 3 页 10 条）
    const page2 = await (await SELF.fetch('http://x/api/admin/audit-logs?type=bulk_test&offset=50', { headers: await adminH() })).json() as any[];
    expect(page2.length).toBe(50);
    expect(page2[0].id).toBeLessThan(filteredLogs[49].id);
    const page3 = await (await SELF.fetch('http://x/api/admin/audit-logs?type=bulk_test&offset=100', { headers: await adminH() })).json() as any[];
    expect(page3.length).toBe(10);

    // 清理，避免影响其他用例
    await env.DB.prepare("DELETE FROM audit_logs WHERE type = 'bulk_test'").run();
  });
});
