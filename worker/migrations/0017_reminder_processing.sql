CREATE TABLE reminders_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  send_at TEXT NOT NULL,
  recipient TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','sent','failed')),
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO reminders_new (id, title, content, send_at, recipient, status, error, created_at, updated_at)
SELECT id, title, content, send_at, recipient, status, error, created_at, updated_at FROM reminders;
DROP TABLE reminders;
ALTER TABLE reminders_new RENAME TO reminders;
CREATE INDEX idx_reminders_due ON reminders(status, send_at);
