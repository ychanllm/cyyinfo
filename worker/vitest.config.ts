import { join } from 'node:path';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig(async () => {
  // 在 Node 侧读取迁移文件，通过 binding 传入 worker（workerd 内无 fs）
  const migrations = await readD1Migrations(join(import.meta.dirname, 'migrations'));
  return {
    test: {
      setupFiles: [],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.toml' },
          miniflare: {
            d1Databases: ['DB'],
            r2Buckets: ['UPLOADS'],
            bindings: {
              JWT_SECRET: 'test-secret',
              ADMIN_USERNAME: 'admin',
              ADMIN_PASSWORD: 'testpass123',
              JWT_EXPIRE_HOURS: '72',
              MIGRATIONS: migrations,
            },
          },
        },
      },
    },
  };
});
