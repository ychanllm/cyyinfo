import { SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, registerUser } from './helpers';

beforeAll(applyMigrations);

// 最小合法 JPEG 字节
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

function uploadForm(file: File) {
  const form = new FormData();
  form.append('file', file);
  return form;
}

describe('用户头像', () => {
  it('未登录上传 401；上传后 /auth/me 返回 avatar 且 /uploads 可读', async () => {
    expect((await SELF.fetch('http://x/api/users/me/avatar', { method: 'POST' })).status).toBe(401);

    const { token } = await registerUser('avatar_user1');
    const auth = { Authorization: `Bearer ${token}` };

    const up = await SELF.fetch('http://x/api/users/me/avatar', {
      method: 'POST', headers: auth,
      body: uploadForm(new File([jpeg], 'a.jpg', { type: 'image/jpeg' })),
    });
    expect(up.status).toBe(200);
    const { avatar } = await up.json() as any;
    expect(avatar).toMatch(/^avatars\//);

    const me = await SELF.fetch('http://x/api/auth/me', { headers: auth });
    expect(((await me.json()) as any).avatar).toBe(avatar);

    const img = await SELF.fetch(`http://x/uploads/${avatar}`);
    expect(img.status).toBe(200);
  });

  it('拒绝非图片和超过 5MB 的文件', async () => {
    const { token } = await registerUser('avatar_user2');
    const auth = { Authorization: `Bearer ${token}` };

    const badType = await SELF.fetch('http://x/api/users/me/avatar', {
      method: 'POST', headers: auth,
      body: uploadForm(new File([new Uint8Array([1, 2, 3])], 'x.txt', { type: 'text/plain' })),
    });
    expect(badType.status).toBe(400);

    const tooBig = await SELF.fetch('http://x/api/users/me/avatar', {
      method: 'POST', headers: auth,
      body: uploadForm(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })),
    });
    expect(tooBig.status).toBe(400);
  });

  it('更换头像会删除旧文件', async () => {
    const { token } = await registerUser('avatar_user3');
    const auth = { Authorization: `Bearer ${token}` };

    const first = await SELF.fetch('http://x/api/users/me/avatar', {
      method: 'POST', headers: auth,
      body: uploadForm(new File([jpeg], 'a.jpg', { type: 'image/jpeg' })),
    });
    const { avatar: oldKey } = await first.json() as any;

    const second = await SELF.fetch('http://x/api/users/me/avatar', {
      method: 'POST', headers: auth,
      body: uploadForm(new File([jpeg], 'b.png', { type: 'image/png' })),
    });
    expect(second.status).toBe(200);
    const { avatar: newKey } = await second.json() as any;
    expect(newKey).not.toBe(oldKey);

    const me = await SELF.fetch('http://x/api/auth/me', { headers: auth });
    expect(((await me.json()) as any).avatar).toBe(newKey);

    // 旧文件已从 R2 删除
    expect((await SELF.fetch(`http://x/uploads/${oldKey}`)).status).toBe(404);
    expect((await SELF.fetch(`http://x/uploads/${newKey}`)).status).toBe(200);
  });
});
