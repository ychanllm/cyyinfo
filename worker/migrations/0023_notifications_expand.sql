CREATE TABLE notifications_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('user','admin')),
  recipient_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('reply','comment','like','thread','prize')),
  message_id INTEGER REFERENCES messages(id),
  actor_nickname TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER,
  detail TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO notifications_new
  SELECT id, recipient_type, recipient_id, type, message_id, actor_nickname, target_type, target_id, NULL, is_read, created_at
  FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;
CREATE INDEX idx_notifications_unread ON notifications(recipient_type, recipient_id, is_read, id);
