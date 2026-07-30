<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';
import Lightbox from '../components/Lightbox.vue';

const route = useRoute();
const album = ref(null);
const loading = ref(true);
const error = ref('');
const lightboxIndex = ref(null);

onMounted(async () => {
  try {
    album.value = await api(`/albums/${route.params.id}`);
  } catch (e) {
    error.value = e.message || '加载失败';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="album-detail">
    <router-link to="/albums" class="back">&larr; 返回相册</router-link>

    <p v-if="loading" class="hint">加载中…</p>
    <p v-else-if="error" class="hint">{{ error }}</p>

    <template v-else-if="album">
      <header class="header">
        <h1 class="title">{{ album.title }}</h1>
        <p v-if="album.description" class="desc">{{ album.description }}</p>
      </header>

      <p v-if="!album.photos.length" class="hint">这个相册还没有照片</p>

      <div v-else class="grid">
        <button
          v-for="(p, i) in album.photos"
          :key="p.id"
          class="cell"
          @click="lightboxIndex = i"
        >
          <img :src="`/uploads/${p.filename}`" :alt="p.caption || ''" class="img" loading="lazy" />
        </button>
      </div>

      <Lightbox :photos="album.photos" v-model:index="lightboxIndex" />
    </template>
  </div>
</template>

<style scoped>
.back {
  display: inline-block;
  font-size: 14px;
  margin-bottom: 16px;
}
.header {
  margin-bottom: 20px;
}
.title {
  font-size: 26px;
  color: var(--color-text);
  margin-bottom: 6px;
}
.desc {
  color: var(--color-text-light);
  font-size: 14px;
}
.hint {
  color: var(--color-text-light);
  font-size: 14px;
  text-align: center;
  padding: 32px 0;
}
.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
@media (max-width: 720px) {
  .grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
@media (max-width: 480px) {
  .grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
.cell {
  aspect-ratio: 1 / 1;
  border: none;
  padding: 0;
  background: var(--bg-deep);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
}
.img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.2s;
}
.cell:hover .img {
  transform: scale(1.04);
}
</style>
