CREATE TABLE likes_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('album','photo','diary','message','store')),
  target_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  count INTEGER NOT NULL DEFAULT 1,
  daily_count INTEGER NOT NULL DEFAULT 0,
  daily_date TEXT,
  UNIQUE(user_id, target_type, target_id)
);
INSERT INTO likes_new SELECT id, user_id, target_type, target_id, created_at, count, daily_count, daily_date FROM likes;
DROP TABLE likes;
ALTER TABLE likes_new RENAME TO likes;
CREATE INDEX IF NOT EXISTS idx_likes_target ON likes(target_type, target_id);
