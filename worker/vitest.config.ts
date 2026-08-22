import { join } from 'node:path';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig(async () => {
  // 在 Node 侧读取迁移文件，通过 binding 传入 worker（workerd 内无 fs）
  const migrations = await readD1Migrations(join(import.meta.dirname, 'migrations'));
  return {
    test: {
      setupFiles: [],
      // 测试共享同一 D1（isolatedStorage 关闭），并行执行时跨文件的待审核留言
      // 会互相干扰（如 messages.test 断言 pending 数量），故串行执行测试文件
      fileParallelism: false,
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.toml' },
          // Windows 上 miniflare 3.20241230.0 的 R2 isolated storage 清理会因
          // sqlite 文件被占用而 EBUSY（Isolated storage failed），故关闭隔离存储，
          // 改为共享存储 + 各测试自行还原数据（passcode 测试已还原口令）。
          isolatedStorage: false,
          singleWorker: true,
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
