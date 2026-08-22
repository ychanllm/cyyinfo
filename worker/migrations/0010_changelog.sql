-- worker/migrations/0010_changelog.sql
-- 管理后台变更日志：版本更新日志（手动维护）+ 用户数据变动审计（自动记录）
CREATE TABLE changelogs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL,
  content TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  actor TEXT,
  detail TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
