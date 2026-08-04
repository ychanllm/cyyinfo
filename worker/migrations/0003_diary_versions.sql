-- 日记编辑版本历史：每次编辑保存记录一条快照，前端按次数和颜色区分
CREATE TABLE IF NOT EXISTS diary_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  diary_id INTEGER NOT NULL REFERENCES diaries(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,                       -- 第 N 次编辑（从 1 起）
  title TEXT NOT NULL,
  content_md TEXT NOT NULL DEFAULT '',
  saved_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_diary_versions_diary ON diary_versions(diary_id, version);
