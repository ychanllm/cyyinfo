-- 日记分类：分类表 + diaries.category_id（旧日记为 NULL = 未分类，不影响已有数据）
CREATE TABLE IF NOT EXISTS diary_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE diaries ADD COLUMN category_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_diaries_category ON diaries(category_id);
