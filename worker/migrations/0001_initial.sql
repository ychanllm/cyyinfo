CREATE TABLE admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover_photo_id INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  taken_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE diaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL REFERENCES admin_users(id),
  title TEXT NOT NULL,
  slug TEXT UNIQUE,
  content_md TEXT NOT NULL DEFAULT '',
  cover_filename TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE music_albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  cover_filename TEXT,
  year INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER NOT NULL REFERENCES music_albums(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  track_no INTEGER NOT NULL DEFAULT 0,
  filename TEXT NOT NULL,
  duration INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL,
  content TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT 'site' CHECK(target_type IN ('diary','photo','site')),
  target_id INTEGER,
  is_approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

INSERT INTO music_albums (title, year, sort_order) VALUES
  ('David Tao', 1997, 1),
  ('I''m OK', 1999, 2),
  ('黑色柳丁', 2002, 3);

INSERT INTO settings (key, value) VALUES
  ('site_name', '我们的小站'),
  ('anniversary_date', ''),
  ('site_passcode_hash', '');
