-- 中英双语内容：现有列为中文版，新增英文列（可空 NULL）。
-- 公开接口 en 语言时 COALESCE(NULLIF(col_en,''), col) 回退中文。
-- settings 表为 key-value，站点文案英文键（site_name_en 等）无需迁移。

ALTER TABLE albums ADD COLUMN title_en TEXT;
ALTER TABLE albums ADD COLUMN description_en TEXT;

ALTER TABLE photos ADD COLUMN caption_en TEXT;

ALTER TABLE diaries ADD COLUMN title_en TEXT;
ALTER TABLE diaries ADD COLUMN content_md_en TEXT;

ALTER TABLE diary_categories ADD COLUMN name_en TEXT;

ALTER TABLE music_albums ADD COLUMN title_en TEXT;

ALTER TABLE songs ADD COLUMN title_en TEXT;
