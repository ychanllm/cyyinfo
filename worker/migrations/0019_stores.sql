-- worker/migrations/0019_stores.sql
-- 探店模块：门店 + 门店「想吃」菜品，与点菜模块（dishes/dish_wants）完全独立
CREATE TABLE stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                       -- 店名
  address TEXT NOT NULL DEFAULT '',         -- 地址
  note TEXT NOT NULL DEFAULT '',            -- 备注（为什么想去、营业时间、人均等）
  image TEXT,                               -- R2 key（stores/ 前缀），可空
  created_by_user_id INTEGER REFERENCES users(id),  -- 用户投稿记用户 id；管理员创建为 NULL
  is_active INTEGER NOT NULL DEFAULT 1,     -- 0 = 下架（公开列表不可见，菜品记录保留）
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE store_dishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                       -- 菜品名
  note TEXT NOT NULL DEFAULT '',            -- 备注（招牌菜、点几人份等）
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_store_dishes_store ON store_dishes(store_id);
