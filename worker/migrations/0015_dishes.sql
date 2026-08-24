-- worker/migrations/0015_dishes.sql
-- 点菜系统：菜品库 + 「想吃」记录（一人一菜一条，再点即取消）
CREATE TABLE dishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image TEXT,                              -- R2 key（dishes/ 前缀），可空
  created_by_user_id INTEGER REFERENCES users(id),  -- 用户投稿记用户 id；管理员创建为 NULL
  is_active INTEGER NOT NULL DEFAULT 1,    -- 0 = 下架（公开列表不可见，想吃记录保留）
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE dish_wants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  dish_id INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, dish_id)
);
