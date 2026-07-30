import { env, applyD1Migrations } from 'cloudflare:test';

export async function applyMigrations() {
  await applyD1Migrations(env.DB, env.MIGRATIONS);
}

export async function adminToken(): Promise<string> {
  const res = await (await import('cloudflare:test')).SELF.fetch('http://x/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD }),
  });
  return ((await res.json()) as any).token;
}
