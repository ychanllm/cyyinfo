ALTER TABLE messages ADD COLUMN user_id INTEGER REFERENCES users(id);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('user','admin')),
  recipient_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('reply','comment')),
  message_id INTEGER NOT NULL REFERENCES messages(id),
  actor_nickname TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notifications_unread
  ON notifications(recipient_type, recipient_id, is_read, id);
