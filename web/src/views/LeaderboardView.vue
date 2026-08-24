<script setup>
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import { localize } from '../i18n';
import Lightbox from '../components/Lightbox.vue';

defineOptions({ name: 'LeaderboardView' });

const { t } = useI18n();
const board = ref(null);
const loading = ref(true);

// 后端返回中英两版字段，站点锁定中文，只取中文字段
const pickTitle = (item) => item.title;
const pickCaption = (p) => p.caption || p.filename;

const medals = ['🥇', '🥈', '🥉'];
const rankLabel = (i) => medals[i] || String(i + 1);

const albumLink = (a) => localize(`/albums/${a.id}`);
const diaryLink = (d) => localize(`/diaries/${d.slug || d.id}`);

// 照片榜：点击缩略图页内灯箱放大；灯箱内可跳转到相册对应照片
const lightboxIndex = ref(null);
const boardPhotos = computed(() => board.value?.photos ?? []);
const photoAlbumLink = (p) => localize(`/albums/${p.album_id}?photo=${p.id}`);

onMounted(async () => {
  try {
    board.value = await api('/leaderboard');
  } catch { /* 加载失败保持空态 */ } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="leaderboard">
    <h1 class="page-title">{{ t('ranking.title') }}</h1>

    <p v-if="loading" class="hint">{{ t('ranking.loading') }}</p>

    <div v-else class="boards">
      <!-- 相册榜 -->
      <section class="card">
        <h2 class="card-title">{{ t('ranking.albums') }}</h2>
        <ol v-if="board?.albums?.length" class="list">
          <li v-for="(a, i) in board.albums" :key="a.id">
            <router-link :to="albumLink(a)" class="item">
              <span class="rank" :class="{ medal: i < 3 }">{{ rankLabel(i) }}</span>
              <span class="name">{{ pickTitle(a) }}</span>
              <span class="stats">
                <span class="stat" :title="t('ranking.views')">👁 {{ a.views }}</span>
                <span class="stat" :title="t('ranking.likes')">♥ {{ a.likes }}</span>
              </span>
            </router-link>
          </li>
        </ol>
        <p v-else class="empty">{{ t('ranking.empty') }}</p>
      </section>

      <!-- 照片榜 -->
      <section class="card">
        <h2 class="card-title">{{ t('ranking.photos') }}</h2>
        <ol v-if="board?.photos?.length" class="list">
          <li v-for="(p, i) in board.photos" :key="p.id">
            <button type="button" class="item item-btn" @click="lightboxIndex = i">
              <span class="rank" :class="{ medal: i < 3 }">{{ rankLabel(i) }}</span>
              <img :src="`/uploads/${p.filename}`" :alt="pickCaption(p)" class="thumb" loading="lazy" />
              <span class="name">{{ pickCaption(p) }}</span>
              <span class="stats">
                <span class="stat" :title="t('ranking.views')">👁 {{ p.views }}</span>
                <span class="stat" :title="t('ranking.likes')">♥ {{ p.likes }}</span>
              </span>
            </button>
          </li>
        </ol>
        <p v-else class="empty">{{ t('ranking.empty') }}</p>
      </section>

      <!-- 日记榜 -->
      <section class="card">
        <h2 class="card-title">{{ t('ranking.diaries') }}</h2>
        <ol v-if="board?.diaries?.length" class="list">
          <li v-for="(d, i) in board.diaries" :key="d.id">
            <router-link :to="diaryLink(d)" class="item">
              <span class="rank" :class="{ medal: i < 3 }">{{ rankLabel(i) }}</span>
              <span class="name">{{ pickTitle(d) }}</span>
              <span class="stats">
                <span class="stat" :title="t('ranking.views')">👁 {{ d.views }}</span>
                <span class="stat" :title="t('ranking.likes')">♥ {{ d.likes }}</span>
              </span>
            </router-link>
          </li>
        </ol>
        <p v-else class="empty">{{ t('ranking.empty') }}</p>
      </section>

      <Lightbox :photos="boardPhotos" v-model:index="lightboxIndex" :album-link="photoAlbumLink" />
    </div>
  </div>
</template>

<style scoped>
.page-title {
  font-family: var(--font-title);
  font-size: 28px;
  font-weight: 400;
  color: var(--color-text);
  text-align: center;
  margin-bottom: 24px;
}
.hint {
  color: var(--color-text-light);
  font-size: 14px;
  text-align: center;
  padding: 32px 0;
}
.boards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
  align-items: start;
}
@media (max-width: 900px) {
  .boards {
    grid-template-columns: 1fr;
  }
}
.card {
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 24px;
}
.card-title {
  font-size: 18px;
  color: var(--color-primary);
  margin-bottom: 16px;
}
.list {
  list-style: none;
  display: flex;
  flex-direction: column;
}
.list li + li {
  border-top: 1px solid var(--color-border);
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 8px;
  border-radius: 8px;
  color: var(--color-text);
}
.item:hover {
  background: var(--bg-deep);
}
.item-btn {
  width: 100%;
  border: none;
  background: none;
  cursor: pointer;
  text-align: left;
  font: inherit;
}
.rank {
  flex: 0 0 28px;
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-light);
}
.rank.medal {
  font-size: 18px;
  font-weight: 400;
}
.thumb {
  width: 44px;
  height: 44px;
  object-fit: cover;
  border-radius: 6px;
  flex: 0 0 auto;
}
.name {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stats {
  display: flex;
  gap: 8px;
  flex: 0 0 auto;
}
.stat {
  font-size: 12px;
  color: var(--color-text-light);
  white-space: nowrap;
}
.empty {
  color: var(--color-text-light);
  font-size: 14px;
  text-align: center;
  padding: 16px 0;
}
</style>
