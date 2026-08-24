<script setup>
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import { localize } from '../i18n';

const { t } = useI18n();
const albums = ref([]);
const loading = ref(true);
const error = ref('');
const PAGE_SIZE = 12;
const page = ref(1);
const total = ref(0);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

async function load(p = 1) {
  loading.value = true;
  error.value = '';
  try {
    const data = await api(`/music/albums?page=${p}&size=${PAGE_SIZE}`);
    albums.value = data.items || data;
    total.value = data.total ?? albums.value.length;
    page.value = p;
  } catch (e) {
    error.value = e.message || '加载失败';
  } finally {
    loading.value = false;
  }
}

onMounted(() => load());
</script>

<template>
  <div class="music">
    <h1 class="page-title">{{ t('music.title') }}</h1>

    <p v-if="loading" class="hint">{{ t('music.loading') }}</p>
    <p v-else-if="error" class="hint">{{ error }}</p>
    <p v-else-if="!albums.length" class="hint">{{ t('music.empty') }}</p>

    <div v-else class="grid">
      <router-link
        v-for="a in albums"
        :key="a.id"
        :to="localize(`/music/${a.id}`)"
        class="card"
      >
        <div class="cover">
          <img
            v-if="a.cover_filename"
            :src="`/uploads/${a.cover_filename}`"
            :alt="a.title"
            class="cover-img"
          />
          <div v-else class="cover-placeholder">
            <span class="placeholder-title">{{ a.title }}</span>
          </div>
        </div>
        <div class="meta">
          <h2 class="title">{{ a.title }}</h2>
          <p class="sub">
            <span v-if="a.year">{{ a.year }} · </span>{{ t('music.songCount', { n: a.song_count }) }}
          </p>
        </div>
      </router-link>
    </div>

    <div v-if="totalPages > 1" class="pager">
      <button :disabled="page <= 1" @click="load(page - 1)">{{ t('diaries.prev') }}</button>
      <span>{{ t('diaries.pageNo', { page, total: totalPages }) }}</span>
      <button :disabled="page >= totalPages" @click="load(page + 1)">{{ t('diaries.next') }}</button>
    </div>
  </div>
</template>

<style scoped>
.page-title {
  font-size: 26px;
  color: var(--color-text);
  margin-bottom: 24px;
}
.hint {
  color: var(--color-text-light);
  font-size: 14px;
  text-align: center;
  padding: 32px 0;
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}
@media (max-width: 720px) {
  .grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 480px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
.card {
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
  color: var(--color-text);
  transition: box-shadow 0.2s;
}
.card:hover {
  box-shadow: var(--shadow-lg);
}
.cover {
  aspect-ratio: 1 / 1;
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
  padding: 16px;
  text-align: center;
}
.placeholder-title {
  color: #fff;
  font-size: 18px;
  font-weight: 600;
  text-shadow: 0 1px 4px rgba(120, 90, 60, 0.3);
}
.meta {
  padding: 14px 16px 16px;
}
.title {
  font-size: 16px;
  margin-bottom: 4px;
}
.sub {
  font-size: 13px;
  color: var(--color-text-light);
}
</style>
