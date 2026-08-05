<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { clearAdminToken } from '../../api';
import { localize } from '../../i18n';
import LangSwitch from '../../components/LangSwitch.vue';
import MiniPlayer from '../../components/MiniPlayer.vue';

const { t } = useI18n();
const router = useRouter();

const navItems = computed(() => [
  { to: localize('/admin/photos'), label: t('admin.photos') },
  { to: localize('/admin/diaries'), label: t('admin.diaries') },
  { to: localize('/admin/diary-categories'), label: t('admin.categories') },
  { to: localize('/admin/music'), label: t('admin.music') },
  { to: localize('/admin/reminders'), label: t('admin.reminders') },
  { to: localize('/admin/messages'), label: t('admin.messages') },
  { to: localize('/admin/users'), label: t('admin.users') },
  { to: localize('/admin/settings'), label: t('admin.settings') },
]);

function logout() {
  clearAdminToken();
  router.replace(localize('/admin/login'));
}
</script>

<template>
  <div class="admin">
    <aside class="sidebar">
      <div class="side-head">
        <h1 class="brand">{{ t('admin.brand') }}</h1>
        <LangSwitch />
      </div>
      <nav class="nav">
        <router-link
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          active-class="active"
        >
          {{ item.label }}
        </router-link>
      </nav>
      <button class="logout" @click="logout">{{ t('admin.logout') }}</button>
    </aside>
    <main class="content">
      <router-view :key="$route.params.lang" />
    </main>
    <MiniPlayer />
  </div>
</template>

<style scoped>
.admin {
  display: flex;
  min-height: 100vh;
}
.sidebar {
  width: 200px;
  flex-shrink: 0;
  background: var(--color-card);
  border-right: 1px solid var(--color-border);
  padding: 24px 16px;
  padding-bottom: 80px; /* 给底部迷你播放器留出空间 */
  display: flex;
  flex-direction: column;
}
.side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 24px;
  padding: 0 8px;
}
.brand {
  font-size: 18px;
  color: var(--color-primary);
  margin: 0;
}
.nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}
.nav-item {
  display: block;
  padding: 10px 12px;
  border-radius: 8px;
  color: var(--color-text);
  font-size: 15px;
}
.nav-item:hover {
  background: var(--bg-deep);
}
.nav-item.active {
  background: var(--color-primary);
  color: #fff;
}
.logout {
  border: 1px solid var(--color-border);
  background: none;
  border-radius: 8px;
  padding: 10px;
  color: var(--color-text-light);
  cursor: pointer;
  font-size: 14px;
}
.logout:hover {
  color: #c0392b;
  border-color: #c0392b;
}
.content {
  flex: 1;
  padding: 32px;
  padding-bottom: 90px; /* 给底部迷你播放器留出空间 */
  min-width: 0;
}
@media (max-width: 720px) {
  .admin {
    flex-direction: column;
  }
  .sidebar {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--color-border);
  }
  .nav {
    flex-direction: row;
    flex-wrap: wrap;
  }
  .content {
    padding: 20px 16px;
  }
}
</style>
