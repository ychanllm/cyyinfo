import { SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigrations, adminToken } from './helpers';

let token: string;
beforeAll(async () => { await applyMigrations(); token = await adminToken(); });
const auth = () => ({ Authorization: `Bearer ${token}` });

describe('音乐', () => {
  it('预置三张专辑，可上传歌曲并按曲目号排序读取', async () => {
    const albums = await (await SELF.fetch('http://x/api/music/albums')).json() as any[];
    expect(albums).toHaveLength(3);
    expect(albums.map((a) => a.title)).toEqual(['David Tao', "I'm OK", '黑色柳丁']);

    const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00]);
    for (const [no, title] of [[2, '黑色柳丁'], [1, 'Dear God']] as const) {
      const form = new FormData();
      form.append('file', new File([mp3], `${title}.mp3`, { type: 'audio/mpeg' }));
      form.append('album_id', String(albums[2].id));
      form.append('title', title);
      form.append('track_no', String(no));
      const res = await SELF.fetch('http://x/api/admin/music/songs', { method: 'POST', headers: auth(), body: form });
      expect(res.status).toBe(200);
    }

    const detail = await (await SELF.fetch(`http://x/api/music/albums/${albums[2].id}`)).json() as any;
    expect(detail.songs.map((s: any) => s.title)).toEqual(['Dear God', '黑色柳丁']);
  });
});
