-- worker/migrations/0011_comment_replies.sql
-- 评论回复：一层楼中楼（回复的回复挂到顶级评论），parent_id 为 NULL 表示顶级评论
ALTER TABLE messages ADD COLUMN parent_id INTEGER;

-- 点赞目标扩展 message：SQLite 不能修改 CHECK 约束，需重建 likes 表
CREATE TABLE likes_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('album', 'photo', 'diary', 'message')),
  target_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, target_type, target_id)
);
INSERT INTO likes_new SELECT * FROM likes;
DROP TABLE likes;
ALTER TABLE likes_new RENAME TO likes;
