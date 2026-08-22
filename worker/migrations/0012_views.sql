-- worker/migrations/0012_views.sql
-- 浏览量统计：每个目标（相册/照片/日记）一行计数，浏览时自增
CREATE TABLE view_counts (
  target_type TEXT NOT NULL CHECK (target_type IN ('album', 'photo', 'diary')),
  target_id INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (target_type, target_id)
);
