import type { Env } from './types';

// 审计日志写入：失败只打日志，绝不阻塞主流程
export async function logAudit(db: Env['DB'], type: string, actor: string | null, detail: string | null): Promise<void> {
  try {
    await db.prepare('INSERT INTO audit_logs (type, actor, detail) VALUES (?, ?, ?)')
      .bind(type, actor, detail).run();
  } catch (e) {
    console.error('logAudit failed:', type, e);
  }
}
