CREATE TABLE files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,        -- R2 key: files/<uuid><ext>
  display_name TEXT NOT NULL,    -- 原始文件名，可重命名
  note TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL,
  content_type TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
