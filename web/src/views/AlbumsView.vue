<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api';

const albums = ref([]);
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    albums.value = await api('/albums');
  } catch (e) {
    error.value = e.message || '加载失败';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="albums">
    <h1 class="page-title">相册</h1>

    <p v-if="loading" class="hint">加载中…</p>
    <p v-else-if="error" class="hint">{{ error }}</p>
    <p v-else-if="!albums.length" class="hint">还没有相册，敬请期待</p>

    <div v-else class="grid">
      <router-link
        v-for="(a, i) in albums"
        :key="a.id"
        :to="`/albums/${a.id}`"
        class="polaroid card"
        :style="{ '--tilt': i % 2 ? '1.3deg' : '-1.4deg' }"
      >
        <span class="tape" :class="i % 3 === 0 ? 'peach' : i % 3 === 1 ? 'stamp' : ''"></span>
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
          <p v-if="a.description" class="desc">{{ a.description }}</p>
        </div>
      </router-link>
    </div>
  </div>
</template>

<style scoped>
.page-title {
  font-family: var(--font-title);
  font-size: 28px;
  color: var(--color-text);
  margin-bottom: 28px;
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
  gap: 30px 24px;
  padding-top: 20px; /* 给胶带留出头顶空间 */
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
  color: var(--color-text);
}
.cover {
  aspect-ratio: 4 / 3;
  overflow: hidden;
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
  background: var(--bg-deep);
  display: flex;
  align-items: center;
  justify-content: center;
}
.placeholder-title {
  color: var(--color-primary-dark);
  font-family: var(--font-title);
  font-size: 20px;
}
.meta {
  padding: 12px 4px 2px;
  text-align: center;
}
.title {
  font-family: var(--font-title);
  font-size: 20px;
  font-weight: 400;
  margin-bottom: 4px;
}
.desc {
  font-size: 13px;
  color: var(--color-text-light);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
