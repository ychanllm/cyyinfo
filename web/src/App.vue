<script setup>
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { getGuestToken, getAdminToken } from './api';
import { loadSiteStatus } from './site-status';
import { autoPlayMusic } from './player';
import NavBar from './components/NavBar.vue';
import DesktopPet from './components/DesktopPet.vue';
import MiniPlayer from './components/MiniPlayer.vue';
import NotificationPopup from './components/NotificationPopup.vue';

const route = useRoute();
const isAdmin = computed(() => route.meta.admin);

// 应用后台「设置 → 背景颜色」（覆盖 CSS 默认）
onMounted(async () => {
  try {
    const s = await loadSiteStatus();
    if (s.background_color) {
      document.documentElement.style.setProperty('--bg', s.background_color);
    }
  } catch { /* 保持 CSS 默认 */ }
  // 已有有效令牌（访客/管理员）直接进入站点时自动播放音乐
  if (getGuestToken() || getAdminToken()) autoPlayMusic();
});
</script>

<template>
  <router-view v-if="isAdmin" />
  <template v-else>
    <NavBar />
    <main class="page">
      <!-- keep-alive 只缓存三个列表页 -->
      <router-view v-slot="{ Component }">
        <keep-alive :include="['AlbumsView', 'DiariesView', 'LeaderboardView']">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </main>
    <DesktopPet />
    <MiniPlayer />
    <NotificationPopup />
  </template>
</template>

<style>
.page {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 20px 64px;
}
</style>
