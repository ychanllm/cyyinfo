-- worker/migrations/0021_like_daily.sql
-- 点赞每日上限：daily_count 记录当日已赞次数，daily_date 为对应日期（UTC+8 的 YYYY-MM-DD）
ALTER TABLE likes ADD COLUMN daily_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE likes ADD COLUMN daily_date TEXT;
