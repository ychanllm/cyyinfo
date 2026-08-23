-- worker/migrations/0014_photo_hidden.sql
-- 照片隐藏：隐藏后前台不展示，R2 文件保留；后台可见并可恢复
ALTER TABLE photos ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
