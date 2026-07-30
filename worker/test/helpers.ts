import { env, applyD1Migrations } from 'cloudflare:test';

export async function applyMigrations() {
  await applyD1Migrations(env.DB, env.MIGRATIONS);
}

// 登录限流 5 次/15 分钟且各测试文件共享同一 runtime，缓存 token 避免触发 429
let cachedToken: string | null = null;

export async function adminToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const res = await (await import('cloudflare:test')).SELF.fetch('http://x/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD }),
  });
  cachedToken = ((await res.json()) as any).token;
  return cachedToken!;
}
