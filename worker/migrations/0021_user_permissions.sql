-- 用户内容权限：管理员可授予注册用户日记/相册上传管理权限
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('diary', 'album')),
  granted_by INTEGER REFERENCES admin_users(id),
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, permission)
);

-- diaries 重建：author_id 改可空，新增 author_user_id（获权用户发布的日记归属用户）
-- diary_versions REFERENCES diaries(id)，重建期间延迟外键检查
PRAGMA defer_foreign_keys = ON;
CREATE TABLE diaries_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER REFERENCES admin_users(id),
  author_user_id INTEGER REFERENCES users(id),
  title TEXT NOT NULL,
  slug TEXT UNIQUE,
  content_md TEXT NOT NULL DEFAULT '',
  cover_filename TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  category_id INTEGER,
  title_en TEXT,
  content_md_en TEXT
);
INSERT INTO diaries_new (id, author_id, title, slug, content_md, cover_filename, status, published_at, created_at, updated_at, category_id, title_en, content_md_en)
  SELECT id, author_id, title, slug, content_md, cover_filename, status, published_at, created_at, updated_at, category_id, title_en, content_md_en FROM diaries;
DROP TABLE diaries;
ALTER TABLE diaries_new RENAME TO diaries;
CREATE INDEX IF NOT EXISTS idx_diaries_category ON diaries(category_id);
CREATE INDEX IF NOT EXISTS idx_diaries_public_order ON diaries(status, category_id, published_at DESC, id);
