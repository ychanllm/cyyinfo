<script setup>
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({
  total: { type: Number, default: 0 },
  page: { type: Number, default: 1 },
  size: { type: Number, default: 20 },
});
const emit = defineEmits(['search', 'page']);
const { t } = useI18n();

const keyword = ref('');
let timer = null;
// 300ms 防抖,输入停顿后才发搜索;由父组件决定页码归零
watch(keyword, (v) => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => emit('search', v.trim()), 300);
});

const pages = computed(() => Math.max(1, Math.ceil(props.total / props.size)));

// 页码窗口:≤7 页全显;否则头尾 + 当前页 ±1,断档处用 0 渲染省略号
const pageList = computed(() => {
  const n = pages.value;
  const cur = Math.min(props.page, n);
  if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1);
  const set = new Set([1, 2, cur - 1, cur, cur + 1, n - 1, n].filter((p) => p >= 1 && p <= n));
  const arr = [...set].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    if (i > 0 && arr[i] - arr[i - 1] > 1) out.push(0);
    out.push(arr[i]);
  }
  return out;
});

function go(p) {
  if (p >= 1 && p <= pages.value && p !== props.page) emit('page', p);
}
</script>

<template>
  <div class="list-bar">
    <input v-model="keyword" type="text" class="search" :placeholder="t('adminList.searchPh')" />
    <span class="total">{{ t('adminList.total', { n: total }) }}</span>
    <nav v-if="pages > 1" class="pager">
      <button class="pg" :disabled="page <= 1" @click="go(page - 1)">‹</button>
      <button
        v-for="(p, i) in pageList"
        :key="i"
        class="pg"
        :class="{ active: p === page }"
        :disabled="p === 0"
        @click="p !== 0 && go(p)"
      >
        {{ p === 0 ? '…' : p }}
      </button>
      <button class="pg" :disabled="page >= pages" @click="go(page + 1)">›</button>
    </nav>
  </div>
</template>

<style scoped>
.list-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.search {
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  width: 200px;
}
.search:focus {
  border-color: var(--color-primary);
}
.total {
  font-size: 13px;
  color: var(--color-text-light);
}
.pager {
  display: flex;
  gap: 4px;
}
.pg {
  min-width: 30px;
  padding: 5px 8px;
  border: 1px solid var(--color-border);
  background: var(--color-card);
  border-radius: 6px;
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
}
.pg.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
.pg:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
