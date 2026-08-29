<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, getUserToken } from '../api';
import { loadSiteStatus } from '../site-status';
import { localize } from '../i18n';
import { me, loadMe } from '../me';
import NotificationBell from './NotificationBell.vue';

const { t } = useI18n();
const route = useRoute();
const siteName = ref('');

async function loadStatus() {
  try {
    const s = await loadSiteStatus();
    siteName.value = s.site_name || t('nav.defaultSiteName');
  } catch {
    siteName.value = t('nav.defaultSiteName');
  }
}

onMounted(loadStatus);

onMounted(loadMe);
// NavBar 不随登录页重挂载：路由变化时同步登录状态——刚登录后补拉 /auth/me，token 失效后清空头像
watch(() => route.fullPath, () => {
  if (getUserToken()) {
    if (!me.value) loadMe();
  } else {
    me.value = null;
  }
});

const links = computed(() => [
  { to: localize('/'), label: t('nav.home'), icon: '🏠', exact: true },
  { to: localize('/albums'), label: t('nav.albums'), icon: '📷' },
  { to: localize('/diaries'), label: t('nav.diaries'), icon: '📔' },
  { to: localize('/leaderboard'), label: t('nav.ranking'), icon: '🏆' },
  { to: localize('/music'), label: t('nav.music'), icon: '🎵' },
  { to: localize('/points'), label: t('nav.points'), icon: '📅' },
  { to: localize('/food'), label: t('nav.food'), icon: '🍲' },
]);
</script>

<template>
  <header class="navbar">
    <div class="inner">
      <div class="left">
        <router-link v-if="me" :to="localize('/points')" class="avatar-link" :title="me.username">
          <img v-if="me.avatar" :src="`/uploads/${me.avatar}`" class="avatar" :alt="me.username" />
          <span v-else class="avatar placeholder">{{ (me.username || '?').charAt(0).toUpperCase() }}</span>
        </router-link>
        <router-link :to="localize('/')" class="brand">{{ siteName }}</router-link>
      </div>
      <div class="right">
        <NotificationBell />
        <nav class="links">
          <router-link
            v-for="l in links"
            :key="l.to"
            :to="l.to"
            class="link"
            :class="{ active: l.exact ? $route.path === l.to : $route.path.startsWith(l.to) }"
            :title="l.label"
            :aria-label="l.label"
          >
            {{ l.icon }}
          </router-link>
        </nav>
      </div>
    </div>
  </header>
</template>

<style scoped>
.navbar {
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgba(255, 248, 240, 0.92);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--color-border);
}
.inner {
  max-width: 960px;
  margin: 0 auto;
  padding: 0 20px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.avatar-link {
  display: flex;
}
.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
}
.avatar.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-primary);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
}
.brand {
  font-family: var(--font-title);
  font-size: 20px;
  font-weight: 400;
  color: var(--color-primary-dark);
}
.right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.links {
  display: flex;
  gap: 2px;
}
.link {
  position: relative;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 19px;
  line-height: 1;
  text-decoration: none;
}
.link:hover {
  background: var(--bg-deep);
}
/* active：emoji 下方一颗小圆点 */
.link.active {
  background: var(--bg-deep);
}
.link.active::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 2px;
  transform: translateX(-50%);
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--color-primary);
}
/* 窄屏：缩小间距，给后续新增入口留位 */
@media (max-width: 480px) {
  .inner {
    padding: 0 10px;
  }
  .left {
    gap: 8px;
  }
  .brand {
    font-size: 17px;
  }
  .right {
    gap: 6px;
  }
  .link {
    padding: 6px 6px;
    font-size: 18px;
  }
}
</style>
