import { Hono } from 'hono';
import type { AppEnv, Env } from '../types';

const storage = new Hono<AppEnv>();

// 扩展名 -> 音频 content-type。
// .m4a 上传时会被 wrangler 误标为 video/mp4，浏览器 <audio> 播放不兼容（尤其 Safari），这里统一修正。
const AUDIO_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  weba: 'audio/webm',
};

function contentTypeFor(key: string, stored?: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return AUDIO_TYPES[ext] ?? stored ?? 'application/octet-stream';
}

// 解析单段 Range 头（bytes=start-end / start- / -suffix）。
// 无或无法解析 -> null（回退 200 全量）；越界 -> { invalid: true }（416）。
function parseRange(header: string | undefined, total: number): { start: number; end: number; invalid?: boolean } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let start = m[1] === '' ? -1 : parseInt(m[1], 10);
  let end = m[2] === '' ? -1 : parseInt(m[2], 10);
  if (start === -1 && end === -1) return null;
  if (start === -1) {               // 后缀范围：最后 N 字节
    start = Math.max(0, total - end);
    end = total - 1;
  } else {
    if (end === -1) end = total - 1;
    end = Math.min(end, total - 1);
  }
  if (start > end || start >= total) return { start, end, invalid: true };
  return { start, end };
}

storage.get('/:path{.+}', async (c) => {
  const key = c.req.param('path');
  const head = await c.env.UPLOADS.head(key);
  if (!head) return c.json({ detail: '文件不存在' }, 404);
  const total = head.size;

  const headers = new Headers();
  headers.set('Content-Type', contentTypeFor(key, head.httpMetadata?.contentType));
  headers.set('Cache-Control', 'public, max-age=2592000');
  headers.set('ETag', head.httpEtag);
  headers.set('Accept-Ranges', 'bytes');

  const range = parseRange(c.req.header('Range'), total);
  if (range?.invalid) {
    headers.set('Content-Range', `bytes */${total}`);
    return new Response(null, { status: 416, headers });
  }

  if (range) {
    // 用 R2 原生 range 读取，只取需要的字节
    const part = await c.env.UPLOADS.get(key, {
      range: { offset: range.start, length: range.end - range.start + 1 },
    });
    if (!part) return c.json({ detail: '范围无效' }, 416);
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${total}`);
    headers.set('Content-Length', String(range.end - range.start + 1));
    return new Response(part.body, { status: 206, headers });
  }

  const obj = await c.env.UPLOADS.get(key);
  if (!obj) return c.json({ detail: '文件不存在' }, 404);
  headers.set('Content-Length', String(total));
  return new Response(obj.body, { status: 200, headers });
});

export default storage;
