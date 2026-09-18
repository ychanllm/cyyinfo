<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import DishesView from './DishesView.vue';
import StoresView from './StoresView.vue';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const tabs = [
  { key: 'dishes', labelKey: 'admin.dishes', component: DishesView },
  { key: 'stores', labelKey: 'admin.stores', component: StoresView },
];

const active = computed(() => (tabs.some((x) => x.key === route.query.tab) ? route.query.tab : 'dishes'));
const activeComponent = computed(() => tabs.find((x) => x.key === active.value).component);

// 切换 tab 用 replace 写 query,不产生历史记录;:key 强制重挂载以重新拉数据
function switchTab(key) {
  if (key !== active.value) router.replace({ query: { tab: key } });
}
</script>

<template>
  <div class="food-view">
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
