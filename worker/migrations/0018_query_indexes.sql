CREATE INDEX IF NOT EXISTS idx_likes_target ON likes(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_dish_wants_dish ON dish_wants(dish_id);
CREATE INDEX IF NOT EXISTS idx_messages_public ON messages(target_type, target_id, is_approved, id);
CREATE INDEX IF NOT EXISTS idx_photos_album_visible ON photos(album_id, hidden, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_songs_album_order ON songs(album_id, track_no, id);
CREATE INDEX IF NOT EXISTS idx_diaries_public_order ON diaries(status, category_id, published_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_point_transactions_user ON point_transactions(user_id, id DESC);
