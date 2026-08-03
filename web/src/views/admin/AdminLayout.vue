<script setup>
import { useRouter } from 'vue-router';
import { clearAdminToken } from '../../api';

const router = useRouter();

const navItems = [
  { to: '/admin/photos', label: '照片' },
  { to: '/admin/diaries', label: '日记' },
  { to: '/admin/music', label: '音乐' },
  { to: '/admin/reminders', label: '提醒' },
  { to: '/admin/messages', label: '留言' },
  { to: '/admin/users', label: '账号' },
  { to: '/admin/settings', label: '设置' },
];

function logout() {
  clearAdminToken();
  router.replace('/admin/login');
}
</script>

<template>
  <div class="admin">
    <aside class="sidebar">
      <h1 class="brand">管理后台</h1>
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
      <button class="logout" @click="logout">退出登录</button>
    </aside>
    <main class="content">
      <router-view />
    </main>
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
  display: flex;
  flex-direction: column;
}
.brand {
  font-size: 18px;
  color: var(--color-primary);
  margin-bottom: 24px;
  padding: 0 8px;
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
