<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, getUserToken } from '../api';
import { i18n, localize } from '../i18n';
import { me, loadMe } from '../me';
import LangSwitch from './LangSwitch.vue';

const { t } = useI18n();
const route = useRoute();
const siteName = ref('');

async function loadStatus() {
  try {
    const s = await api('/site/status');
    siteName.value = s.site_name || t('nav.defaultSiteName');
  } catch {
    siteName.value = t('nav.defaultSiteName');
  }
}

onMounted(loadStatus);
// NavBar 在 router-view 外，切语言时需重新拉本地化的站点名
watch(() => i18n.global.locale.value, loadStatus);

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
  { to: localize('/'), label: t('nav.home'), exact: true },
  { to: localize('/albums'), label: t('nav.albums') },
  { to: localize('/diaries'), label: t('nav.diaries') },
  { to: localize('/leaderboard'), label: t('nav.ranking') },
  { to: localize('/music'), label: t('nav.music') },
  { to: localize('/points'), label: t('nav.points') },
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
        <nav class="links">
          <router-link
            v-for="l in links"
            :key="l.to"
            :to="l.to"
            class="link"
            :class="{ active: l.exact ? $route.path === l.to : $route.path.startsWith(l.to) }"
          >
            {{ l.label }}
          </router-link>
        </nav>
        <LangSwitch />
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
  gap: 4px;
}
.link {
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 15px;
  color: var(--color-text-light);
}
.link:hover {
  color: var(--color-primary);
  background: var(--bg-deep);
}
.link.active {
  color: var(--color-primary);
  background: var(--bg-deep);
  font-weight: 600;
}
</style>
