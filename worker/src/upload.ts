import type { Env } from './types';

const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
};
const AUDIO_TYPES: Record<string, string> = {
  'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a',
};
const MAX_IMAGE = 10 * 1024 * 1024;   // 10MB
const MAX_AUDIO = 30 * 1024 * 1024;   // 30MB

export async function saveUpload(
  env: Env, file: File, kind: 'image' | 'audio', prefix: string,
): Promise<{ key?: string; error?: string }> {
  const table = kind === 'image' ? IMAGE_TYPES : AUDIO_TYPES;
  const ext = table[file.type];
  if (!ext) return { error: '不支持的文件类型' };
  if (file.size > (kind === 'image' ? MAX_IMAGE : MAX_AUDIO)) return { error: '文件过大' };
  const key = `${prefix}/${crypto.randomUUID()}${ext}`;
  await env.UPLOADS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return { key };
}
