<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import { localize } from '../i18n';
import { state, playQueue } from '../player';

const { t } = useI18n();
const route = useRoute();
const album = ref(null);
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    album.value = await api(`/music/albums/${route.params.id}`);
  } catch (e) {
    error.value = e.message || '加载失败';
  } finally {
    loading.value = false;
  }
});

function isCurrent(song) {
  const cur = state.queue[state.index];
  return !!cur && cur.id === song.id;
}

function playAt(i) {
  if (!album.value) return;
  playQueue(album.value.songs, i);
}

function fmt(sec) {
  if (!sec || !isFinite(sec)) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
</script>

<template>
  <div class="album-detail">
    <router-link :to="localize('/music')" class="back">&larr; {{ t('musicAlbum.back') }}</router-link>

    <p v-if="loading" class="hint">{{ t('musicAlbum.loading') }}</p>
    <p v-else-if="error" class="hint">{{ error }}</p>

    <template v-else-if="album">
      <div class="header">
        <div class="cover">
          <img
            v-if="album.cover_filename"
            :src="`/uploads/${album.cover_filename}`"
            :alt="album.title"
            class="cover-img"
          />
          <div v-else class="cover-placeholder">
            <span class="placeholder-title">{{ album.title }}</span>
          </div>
        </div>
        <div class="info">
          <h1 class="title">{{ album.title }}</h1>
          <p v-if="album.year" class="year">{{ album.year }}</p>
          <p class="count">{{ t('musicAlbum.totalSongs', { n: album.songs.length }) }}</p>
        </div>
      </div>

      <p v-if="!album.songs.length" class="hint">{{ t('musicAlbum.noSongs') }}</p>

      <ul v-else class="songs">
        <li
          v-for="(s, i) in album.songs"
          :key="s.id"
          class="song"
          :class="{ current: isCurrent(s) }"
        >
          <span class="track-no">{{ s.track_no }}</span>
          <span class="song-title">{{ s.title }}</span>
          <span v-if="s.duration" class="duration">{{ fmt(s.duration) }}</span>
          <button
            type="button"
            class="play-btn"
            :title="isCurrent(s) && state.playing ? t('musicAlbum.playing') : t('musicAlbum.play')"
            @click="playAt(i)"
          >
            {{ isCurrent(s) && state.playing ? '♪' : '▶' }}
          </button>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.back {
  display: inline-block;
  font-size: 14px;
  margin-bottom: 16px;
}
.hint {
  color: var(--color-text-light);
  font-size: 14px;
  text-align: center;
  padding: 32px 0;
}
.header {
  display: flex;
  gap: 24px;
  align-items: flex-end;
  margin-bottom: 28px;
}
.cover {
  width: 180px;
  aspect-ratio: 1 / 1;
  border-radius: var(--radius);
  overflow: hidden;
  box-shadow: var(--shadow);
  flex-shrink: 0;
}
.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.cover-placeholder {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, var(--bg-deep), var(--color-accent));
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  text-align: center;
}
.placeholder-title {
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  text-shadow: 0 1px 4px rgba(120, 90, 60, 0.3);
}
.title {
  font-size: 26px;
  color: var(--color-text);
  margin-bottom: 6px;
}
.year {
  font-size: 14px;
  color: var(--color-text-light);
  margin-bottom: 4px;
}
.count {
  font-size: 13px;
  color: var(--color-text-light);
}
.songs {
  list-style: none;
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.song {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--color-border);
}
.song:last-child {
  border-bottom: none;
}
.song.current {
  background: var(--bg-deep);
}
.song.current .song-title {
  color: var(--color-primary);
  font-weight: 600;
}
.track-no {
  width: 24px;
  font-size: 13px;
  color: var(--color-text-light);
  font-variant-numeric: tabular-nums;
}
.song-title {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.duration {
  font-size: 13px;
  color: var(--color-text-light);
  font-variant-numeric: tabular-nums;
}
.play-btn {
  border: none;
  background: none;
  cursor: pointer;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  font-size: 13px;
  color: var(--color-primary);
  line-height: 1;
}
.play-btn:hover {
  background: var(--color-primary);
  color: #fff;
}
@media (max-width: 600px) {
  .header {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
