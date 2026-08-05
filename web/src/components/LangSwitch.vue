<script setup>
import { useRoute } from 'vue-router';
import { LOCALES } from '../i18n';

const route = useRoute();

// 把当前路径第 1 段换成目标语言，保留 query
function switchTo(target) {
  const parts = route.path.split('/');
  parts[1] = target;
  const qs = Object.keys(route.query).length
    ? '?' + new URLSearchParams(route.query).toString()
    : '';
  return parts.join('/') + qs;
}
</script>

<template>
  <div class="lang-switch">
    <router-link
      v-for="l in LOCALES"
      :key="l"
      :to="switchTo(l)"
      class="lang-btn"
      :class="{ active: route.params.lang === l }"
    >
      {{ l === 'zh' ? '中文' : 'EN' }}
    </router-link>
  </div>
</template>

<style scoped>
.lang-switch {
  display: flex;
  align-items: center;
  gap: 4px;
}
.lang-btn {
  padding: 4px 10px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--color-text-light);
  text-decoration: none;
  transition: all 0.2s;
}
.lang-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.lang-btn.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
</style>
