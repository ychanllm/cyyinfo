<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';
import Lightbox from '../components/Lightbox.vue';

const route = useRoute();
const album = ref(null);
const loading = ref(true);
const error = ref('');
const lightboxIndex = ref(null);

// 横向滑动拍立得
const carouselEl = ref(null);
const activeIndex = ref(0);

async function load() {
  loading.value = true;
  error.value = '';
  activeIndex.value = 0;
  try {
    album.value = await api(`/albums/${route.params.id}`);
  } catch (e) {
    error.value = e.message || '加载失败';
  } finally {
    loading.value = false;
  }
}

function onScroll() {
  const el = carouselEl.value;
  if (!el) return;
  const center = el.scrollLeft + el.clientWidth / 2;
  const slides = [...el.children];
  let idx = 0;
  let best = Infinity;
  slides.forEach((child, i) => {
    const c = child.offsetLeft + child.offsetWidth / 2;
    const d = Math.abs(c - center);
    if (d < best) {
      best = d;
      idx = i;
    }
  });
  if (idx !== activeIndex.value) activeIndex.value = idx;
}

function goTo(dir) {
  const el = carouselEl.value;
  const target = el?.children[activeIndex.value + dir];
  target?.scrollIntoView({ behavior: 'smooth', inline: 'center' });
}

function onKeydown(e) {
  if (lightboxIndex.value !== null) return; // Lightbox 打开时由它处理键盘
  if (e.key === 'ArrowLeft') goTo(-1);
  else if (e.key === 'ArrowRight') goTo(1);
}

onMounted(() => {
  load();
  window.addEventListener('keydown', onKeydown);
});
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
watch(() => route.params.id, load);
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

      <template v-else>
        <div class="carousel" ref="carouselEl" @scroll.passive="onScroll">
          <button
            v-for="(p, i) in album.photos"
            :key="p.id"
            class="polaroid slide"
            :class="{ active: i === activeIndex }"
            :style="{ '--tilt': `${(i - activeIndex) * 0.6}deg` }"
            @click="lightboxIndex = i"
          >
            <img :src="`/uploads/${p.filename}`" :alt="p.caption || ''" class="ph-img" loading="lazy" />
            <span class="ph-caption">{{ p.caption || '· · ·' }}</span>
          </button>
        </div>

        <div class="controls">
          <button class="nav" :disabled="activeIndex <= 0" @click="goTo(-1)" aria-label="上一张">&#8249;</button>
          <span class="counter font-hand">{{ activeIndex + 1 }} / {{ album.photos.length }}</span>
          <button class="nav" :disabled="activeIndex >= album.photos.length - 1" @click="goTo(1)" aria-label="下一张">&#8250;</button>
        </div>
      </template>

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
  font-family: var(--font-title);
  font-size: 28px;
  font-weight: 400;
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

.carousel {
  position: relative; /* offsetLeft 参考系，onScroll 计数依赖 */
  display: flex;
  gap: 26px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  padding: 20px 12px 14px;
  scrollbar-width: none;
}
.carousel::-webkit-scrollbar {
  display: none;
}

.slide {
  flex: 0 0 min(72vw, 360px);
  scroll-snap-align: center;
  border: none;
  cursor: pointer;
  text-align: left;
}
.slide.active {
  box-shadow: var(--shadow-lg);
}

.controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  margin-top: 14px;
}
.nav {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid var(--color-border);
  background: var(--color-card);
  color: var(--color-primary-dark);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}
.nav:hover:not(:disabled) {
  background: var(--color-accent);
}
.nav:disabled {
  opacity: 0.4;
  cursor: default;
}
.counter {
  color: var(--color-text-light);
  font-size: 22px;
  min-width: 80px;
  text-align: center;
}
</style>
