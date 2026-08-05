<script setup>
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api } from './api';
import NavBar from './components/NavBar.vue';
import DesktopPet from './components/DesktopPet.vue';
import MiniPlayer from './components/MiniPlayer.vue';

const route = useRoute();
const isAdmin = computed(() => route.meta.admin);

// 应用后台「设置 → 背景颜色」（覆盖 CSS 默认）
onMounted(async () => {
  try {
    const s = await api('/site/status');
    if (s.background_color) {
      document.documentElement.style.setProperty('--bg', s.background_color);
    }
  } catch { /* 保持 CSS 默认 */ }
});
</script>

<template>
  <router-view v-if="isAdmin" :key="$route.params.lang" />
  <template v-else>
    <NavBar />
    <main class="page">
      <router-view :key="$route.params.lang" />
    </main>
    <DesktopPet />
    <MiniPlayer />
  </template>
</template>

<style>
.page {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 20px 64px;
}
</style>
