<script setup>
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { getAdminToken, clearAdminToken } from '../../api';
import { localize } from '../../i18n';
import { navOrder, applyNavOrder, loadNavOrder } from '../../utils/admin-nav';
import { me, loadMe } from '../../me';
import MiniPlayer from '../../components/MiniPlayer.vue';

const { t } = useI18n();
const router = useRouter();

// 无管理员令牌时按获权用户处理：只看到「素材」栏目（具体 tab 由 MediaView 按权限再过滤）
const isAdmin = Boolean(getAdminToken());
const navItems = computed(() => {
  let items = applyNavOrder(navOrder.value);
  if (!isAdmin) items = items.filter((item) => item.key === 'media');
  return items.map((item) => ({ to: localize(item.path), label: t(item.labelKey) }));
});

// 自定义排序设置是管理员接口，获权用户调用会 401，仅在管理员身份下加载
onMounted(() => {
  if (isAdmin) loadNavOrder();
  else if (!me.value) loadMe();
});

function logout() {
  if (isAdmin) {
    clearAdminToken();
    router.replace(localize('/admin/login'));
  } else {
    // 获权用户退出后台：保留站点登录态，回前台首页
    router.replace(localize('/'));
  }
}
</script>

<template>
  <div class="admin">
    <aside class="sidebar">
      <div class="side-head">
        <h1 class="brand">{{ t('admin.brand') }}</h1>
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
      <router-view />
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
