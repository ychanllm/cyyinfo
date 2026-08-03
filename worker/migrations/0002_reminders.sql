-- 提醒事项：到点自动发邮件
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  send_at TEXT NOT NULL,                      -- 计划发送时间 'YYYY-MM-DD HH:MM:SS'
  recipient TEXT NOT NULL DEFAULT '',         -- 收件邮箱，空则用设置里的默认收件人
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, send_at);
