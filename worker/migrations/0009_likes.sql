-- worker/migrations/0009_likes.sql
-- 点赞：一个用户对同一目标（相册/照片/日记）只能赞一次，再点即取消
CREATE TABLE likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('album', 'photo', 'diary')),
  target_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, target_type, target_id)
);
