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

// 注册测试用户并返回 {id, token}；注册接口限流 30 次/15 分钟，够用但不要滥用
export async function registerUser(username: string): Promise<{ id: number; token: string }> {
  const { SELF } = await import('cloudflare:test');
  const res = await SELF.fetch('http://x/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'secret6' }),
  });
  const data = (await res.json()) as any;
  if (!data.token) throw new Error(`registerUser(${username}) 失败: ${JSON.stringify(data)}`);
  const me = await SELF.fetch('http://x/api/auth/me', {
    headers: { Authorization: `Bearer ${data.token}` },
  });
  const { id } = (await me.json()) as any;
  return { id, token: data.token };
}
