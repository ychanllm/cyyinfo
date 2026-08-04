<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../api';

const PAGE_SIZE = 10; // 与后端每页条数一致

const diaries = ref([]);
const total = ref(0);
const page = ref(1);
const loading = ref(true);
const error = ref('');
const categories = ref([]); // 分类筛选 chips
const activeCategory = ref(null); // null = 全部

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

function fmtDate(s) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s || '').slice(0, 10);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

async function load(p) {
  loading.value = true;
  error.value = '';
  try {
    const q = new URLSearchParams({ page: String(p) });
    if (activeCategory.value) q.set('category', activeCategory.value);
    const data = await api(`/diaries?${q}`);
    diaries.value = data.items || [];
    total.value = data.total || 0;
    page.value = p;
  } catch (e) {
    error.value = e.message || '加载失败';
  } finally {
    loading.value = false;
  }
}

function selectCategory(id) {
  activeCategory.value = id;
  load(1); // 切换分类回到第 1 页
}

onMounted(async () => {
  load(1);
  try {
    categories.value = await api('/diary-categories');
  } catch { /* 分类加载失败不阻塞日记列表 */ }
});
</script>

<template>
  <div class="diaries">
    <h1 class="page-title">日记</h1>

    <div v-if="categories.length" class="cat-filter">
      <button
        class="chip"
        :class="{ active: activeCategory === null }"
        @click="selectCategory(null)"
      >全部</button>
      <button
        v-for="cat in categories"
        :key="cat.id"
        class="chip"
        :class="{ active: activeCategory === cat.id }"
        @click="selectCategory(cat.id)"
      >
        {{ cat.name }}<span v-if="cat.count" class="chip-count">{{ cat.count }}</span>
      </button>
    </div>

    <p v-if="loading" class="hint">加载中…</p>
    <p v-else-if="error" class="hint">{{ error }}</p>
    <p v-else-if="!diaries.length" class="hint">
      {{ activeCategory ? '该分类下还没有日记' : '还没有日记，敬请期待' }}
    </p>

    <template v-else>
      <router-link
        v-for="d in diaries"
        :key="d.id"
        :to="`/diaries/${d.slug || d.id}`"
        class="card"
      >
        <img
          v-if="d.cover_filename"
          :src="`/uploads/${d.cover_filename}`"
          :alt="d.title"
          class="cover"
        />
        <div class="meta">
          <h2 class="title">{{ d.title }}</h2>
          <p v-if="d.excerpt" class="excerpt">{{ d.excerpt }}</p>
          <p class="info">
            <span v-if="d.category_name" class="cat-badge">{{ d.category_name }}</span>
            {{ d.author }} · {{ fmtDate(d.published_at) }}
          </p>
        </div>
      </router-link>

      <div v-if="totalPages > 1" class="pager">
        <button :disabled="page <= 1" @click="load(page - 1)">上一页</button>
        <span class="page-no">第 {{ page }} / {{ totalPages }} 页</span>
        <button :disabled="page >= totalPages" @click="load(page + 1)">下一页</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page-title {
  font-size: 26px;
  margin-bottom: 24px;
}
.hint {
  color: var(--color-text-light);
  font-size: 14px;
  text-align: center;
  padding: 32px 0;
}
.cat-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
}
.chip {
  border: 1px solid var(--color-border);
  background: var(--color-card);
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
}
.chip:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.chip.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
.chip-count {
  margin-left: 4px;
  opacity: 0.7;
  font-size: 12px;
}
.cat-badge {
  display: inline-block;
  background: var(--color-primary);
  color: #fff;
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 999px;
  margin-right: 6px;
}
.card {
  display: block;
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
  color: var(--color-text);
  margin-bottom: 20px;
  transition: box-shadow 0.2s;
}
.card:hover {
  box-shadow: var(--shadow-lg);
}
.cover {
  width: 100%;
  max-height: 260px;
  object-fit: cover;
  display: block;
}
.meta {
  padding: 16px 20px 18px;
}
.title {
  font-size: 18px;
  margin-bottom: 6px;
}
.excerpt {
  font-size: 14px;
  color: var(--color-text-light);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 8px;
}
.info {
  font-size: 13px;
  color: var(--color-text-light);
}
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-top: 8px;
}
.pager button {
  padding: 8px 20px;
  border: none;
  border-radius: 8px;
  background: var(--color-primary);
  color: #fff;
  cursor: pointer;
}
.pager button:hover:not(:disabled) {
  background: var(--color-primary-dark);
}
.pager button:disabled {
  opacity: 0.5;
  cursor: default;
}
.page-no {
  font-size: 13px;
  color: var(--color-text-light);
}
</style>
