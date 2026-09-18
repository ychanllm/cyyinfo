<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import PhotosView from './PhotosView.vue';
import DiariesView from './DiariesView.vue';
import MusicView from './MusicView.vue';
import { getAdminToken } from '../../api';
import { me } from '../../me';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const allTabs = [
  { key: 'photos', labelKey: 'admin.photos', component: PhotosView, perm: 'album' },
  { key: 'diaries', labelKey: 'admin.diaries', component: DiariesView, perm: 'diary' },
  { key: 'music', labelKey: 'admin.music', component: MusicView, perm: null },
];

// 管理员看全部；获权用户只看有权限的 tab（music 仅管理员）
const tabs = computed(() => {
  if (getAdminToken()) return allTabs;
  const perms = me.value?.permissions ?? [];
  return allTabs.filter((x) => x.perm && perms.includes(x.perm));
});

const active = computed(() => (tabs.value.some((x) => x.key === route.query.tab) ? route.query.tab : tabs.value[0]?.key));
const activeComponent = computed(() => tabs.value.find((x) => x.key === active.value)?.component);

// 切换 tab 用 replace 写 query,不产生历史记录;:key 强制重挂载以重新拉数据
function switchTab(key) {
  if (key !== active.value) router.replace({ query: { tab: key } });
}
</script>

<template>
  <div class="media-view">
    <div class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab"
        :class="{ active: active === tab.key }"
        @click="switchTab(tab.key)"
      >
        {{ t(tab.labelKey) }}
      </button>
    </div>
    <component :is="activeComponent" :key="active" />
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}
.tab {
  border: 1px solid var(--color-border);
  background: var(--color-card);
  border-radius: 8px;
  padding: 8px 20px;
  font-size: 14px;
  color: var(--color-text);
  cursor: pointer;
}
.tab.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
</style>
