import type { Env } from './types';

const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'image/heic': '.heic', 'image/heif': '.heif',
};
// 部分手机浏览器/文件选择器不上报 MIME（或上报非标类型）时，按文件名扩展名回退判断
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif']);
const AUDIO_TYPES: Record<string, string> = {
  'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a',
};
const MAX_IMAGE = 10 * 1024 * 1024;   // 10MB
const MAX_AUDIO = 30 * 1024 * 1024;   // 30MB

export async function saveUpload(
  env: Env, file: File, kind: 'image' | 'audio', prefix: string,
): Promise<{ key?: string; error?: string }> {
  const table = kind === 'image' ? IMAGE_TYPES : AUDIO_TYPES;
  let ext = table[file.type];
  if (!ext && kind === 'image') {
    const name = (file.name || '').toLowerCase();
    const byName = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
    if (IMAGE_EXTS.has(byName)) ext = byName === '.jpeg' ? '.jpg' : byName;
  }
  if (!ext) return { error: '不支持的文件类型' };
  if (file.size > (kind === 'image' ? MAX_IMAGE : MAX_AUDIO)) return { error: '文件过大' };
  const key = `${prefix}/${crypto.randomUUID()}${ext}`;
  await env.UPLOADS.put(key, await file.arrayBuffer(),
    file.type ? { httpMetadata: { contentType: file.type } } : undefined);
  return { key };
}
