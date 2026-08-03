<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { marked } from 'marked';
import { api } from '../api';
import MessageBoard from '../components/MessageBoard.vue';

const route = useRoute();

const diary = ref(null);
const loading = ref(true);
const error = ref('');

// v-html 安全前提：content_md 为管理员自写的可信内容，首版不做消毒（spec 决策）。
const html = computed(() => (diary.value ? marked.parse(diary.value.content_md || '') : ''));

function fmtDate(s) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s || '').slice(0, 10);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

onMounted(async () => {
  try {
    diary.value = await api(`/diaries/${route.params.slugOrId}`);
  } catch (e) {
    error.value = e.message || '加载失败';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="diary-detail">
    <router-link to="/diaries" class="back">&larr; 返回日记</router-link>

    <p v-if="loading" class="hint">加载中…</p>
    <p v-else-if="error" class="hint">{{ error }}</p>

    <template v-else-if="diary">
      <article class="article">
        <img
          v-if="diary.cover_filename"
          :src="`/uploads/${diary.cover_filename}`"
          :alt="diary.title"
          class="cover"
        />
        <h1 class="title">{{ diary.title }}</h1>
        <p class="meta">{{ diary.author }} · {{ fmtDate(diary.published_at) }}</p>
        <div class="md-body" v-html="html"></div>
      </article>
      <MessageBoard targetType="diary" :targetId="diary.id" />
    </template>
  </div>
</template>

<style scoped>
.diary-detail {
  max-width: 680px;
  margin: 0 auto;
}
.back {
  display: inline-block;
  font-size: 14px;
  margin-bottom: 16px;
}
.hint {
  color: var(--color-text-light);
  font-size: 14px;
  text-align: center;
  padding: 32px 0;
}
.article {
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 32px 36px;
  margin-bottom: 24px;
}
.cover {
  width: 100%;
  border-radius: 8px;
  display: block;
  margin-bottom: 24px;
}
.title {
  font-size: 24px;
  line-height: 1.4;
  margin-bottom: 10px;
}
.meta {
  font-size: 13px;
  color: var(--color-text-light);
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--color-border);
}
@media (max-width: 480px) {
  .article {
    padding: 20px 18px;
  }
}
</style>
