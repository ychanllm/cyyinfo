import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, adminToken, registerUser } from './helpers';

let admin: string;
beforeAll(async () => { await applyMigrations(); admin = await adminToken(); });
const adminAuth = () => ({ Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' });
const userAuth = (t: string) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

async function grant(userId: number, permission: 'diary' | 'album') {
  await env.DB.prepare('INSERT OR REPLACE INTO user_permissions (user_id, permission) VALUES (?, ?)')
    .bind(userId, permission).run();
}
async function revokeAll(userId: number) {
  await env.DB.prepare('DELETE FROM user_permissions WHERE user_id = ?').bind(userId).run();
}

describe('内容权限中间件', () => {
  it('无权限用户访问日记/相册后台路由返回 401，管理员不受影响', async () => {
    const u = await registerUser('perm_none');
    const d = await SELF.fetch('http://x/api/admin/diaries', { headers: userAuth(u.token) });
    expect(d.status).toBe(401);
    const a = await SELF.fetch('http://x/api/admin/albums', { headers: userAuth(u.token) });
    expect(a.status).toBe(401);
    const ok = await SELF.fetch('http://x/api/admin/diaries', { headers: adminAuth() });
    expect(ok.status).toBe(200);
  });

  it('diary 权限用户可访问日记与分类路由，但相册与其余后台路由仍 401', async () => {
    const u = await registerUser('perm_diary');
    await grant(u.id, 'diary');
    const d = await SELF.fetch('http://x/api/admin/diaries', { headers: userAuth(u.token) });
    expect(d.status).toBe(200);
    const cats = await SELF.fetch('http://x/api/admin/diary-categories', { headers: userAuth(u.token) });
    expect(cats.status).toBe(200);
    const a = await SELF.fetch('http://x/api/admin/albums', { headers: userAuth(u.token) });
    expect(a.status).toBe(401);
    const users = await SELF.fetch('http://x/api/admin/site-users', { headers: userAuth(u.token) });
    expect(users.status).toBe(401);
    const settings = await SELF.fetch('http://x/api/admin/settings', { headers: userAuth(u.token) });
    expect(settings.status).toBe(401);
  });

  it('album 权限用户可上传照片到相册，撤销后立即 401', async () => {
    const u = await registerUser('perm_album');
    // 管理员建相册
    const alb = await SELF.fetch('http://x/api/admin/albums', {
      method: 'POST', headers: adminAuth(), body: JSON.stringify({ title: '权限测试相册' }),
    });
    const { id: albumId } = await alb.json() as any;

    await grant(u.id, 'album');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const form = new FormData();
    form.append('file', new File([png], 'p.png', { type: 'image/png' }));
    form.append('album_id', String(albumId));
    const up = await SELF.fetch('http://x/api/admin/photos', {
      method: 'POST', headers: { Authorization: `Bearer ${u.token}` }, body: form,
    });
    expect(up.status).toBe(200);
    const photo = await up.json() as any;

    // 用户操作照片的审计操作人记为 user:<username>
    const logs = await env.DB.prepare(
      "SELECT actor FROM audit_logs WHERE type = 'photo_upload' ORDER BY id DESC LIMIT 1"
    ).first<{ actor: string }>();
    expect(logs?.actor).toBe('user:perm_album');

    // 撤销后立即失效
    await revokeAll(u.id);
    const denied = await SELF.fetch('http://x/api/admin/photos', {
      method: 'POST', headers: { Authorization: `Bearer ${u.token}` }, body: form,
    });
    expect(denied.status).toBe(401);

    // 清理（管理员）
    await SELF.fetch(`http://x/api/admin/photos/${photo.id}`, { method: 'DELETE', headers: adminAuth() });
    await SELF.fetch(`http://x/api/admin/albums/${albumId}`, { method: 'DELETE', headers: adminAuth() });
  });
});
