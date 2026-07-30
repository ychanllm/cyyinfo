<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api';

const siteName = ref('');

onMounted(async () => {
  try {
    const s = await api('/site/status');
    siteName.value = s.site_name || '我们的小站';
  } catch {
    siteName.value = '我们的小站';
  }
});

const links = [
  { to: '/', label: '首页', exact: true },
  { to: '/albums', label: '相册' },
  { to: '/diaries', label: '日记' },
  { to: '/music', label: '音乐' },
];
</script>

<template>
  <header class="navbar">
    <div class="inner">
      <router-link to="/" class="brand">{{ siteName }}</router-link>
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
    </div>
  </header>
</template>

<style scoped>
.navbar {
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgba(255, 253, 249, 0.92);
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
.brand {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-primary);
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
