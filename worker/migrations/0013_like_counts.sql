-- worker/migrations/0013_like_counts.sql
-- 连赞：同一用户对同一目标可累加多个赞（每行 count 累加，上限 50 由后端控制），计数改用 SUM(count)
ALTER TABLE likes ADD COLUMN count INTEGER NOT NULL DEFAULT 1;
