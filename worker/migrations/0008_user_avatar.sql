-- worker/migrations/0008_user_avatar.sql
-- 注册用户头像：存 R2 文件名（/uploads/<key> 访问）
ALTER TABLE users ADD COLUMN avatar TEXT;
