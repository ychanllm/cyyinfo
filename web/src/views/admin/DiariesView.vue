<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../api';

const router = useRouter();

const diaries = ref([]);
const loading = ref(true);
const error = ref('');

async function loadDiaries() {
  loading.value = true;
  error.value = '';
  try {
    diaries.value = await api('/admin/diaries', { admin: true });
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function toggleStatus(diary) {
  const target = diary.status === 'published' ? 'draft' : 'published';
  error.value = '';
  try {
    await api(`/admin/diaries/${diary.id}`, {
      method: 'PUT',
      admin: true,
      body: { status: target },
    });
    await loadDiaries();
  } catch (e) {
    error.value = e.message;
  }
}

function fmtTime(s) {
  if (!s) return '—';
  const d = new Date(s.endsWith('Z') || s.includes('+') ? s : `${s.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return s;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

onMounted(loadDiaries);
</script>

<template>
  <div class="diaries-view">
    <div class="head">
      <h2 class="page-title">日记管理</h2>
      <button class="btn primary" @click="router.push('/admin/diaries/new')">写日记</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <section class="card">
      <p v-if="loading" class="hint">加载中…</p>
      <p v-else-if="!diaries.length" class="hint">还没有日记，点击右上角「写日记」开始吧</p>
      <table v-else class="diary-table">
        <thead>
          <tr>
            <th>标题</th>
            <th>slug</th>
            <th>分类</th>
            <th class="col-status">状态</th>
            <th class="col-time">更新时间</th>
            <th class="col-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="diary in diaries" :key="diary.id">
            <td class="title-cell">{{ diary.title }}</td>
            <td class="slug-cell">{{ diary.slug || '—' }}</td>
            <td class="cat-cell">{{ diary.category_name || '—' }}</td>
            <td class="col-status">
              <span class="badge" :class="diary.status === 'published' ? 'published' : 'draft'">
                {{ diary.status === 'published' ? '已发布' : '草稿' }}
              </span>
            </td>
            <td class="col-time">{{ fmtTime(diary.updated_at) }}</td>
            <td class="col-actions">
              <button class="btn" @click="router.push(`/admin/diaries/${diary.id}/edit`)">编辑</button>
              <button class="btn" @click="toggleStatus(diary)">
                {{ diary.status === 'published' ? '撤回' : '发布' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.page-title {
  font-size: 22px;
}
.error {
  color: #c0392b;
  font-size: 14px;
  margin-bottom: 16px;
}
.card {
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 20px 24px;
}
.hint {
  color: var(--color-text-light);
  font-size: 14px;
}
.diary-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.diary-table th {
  text-align: left;
  color: var(--color-text-light);
  font-weight: normal;
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border);
}
.diary-table td {
  padding: 10px 8px;
  border-bottom: 1px solid var(--color-border);
}
.title-cell {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.slug-cell,
.cat-cell {
  color: var(--color-text-light);
}
.col-status {
  width: 90px;
}
.col-time {
  width: 150px;
  color: var(--color-text-light);
  white-space: nowrap;
}
.col-actions {
  width: 200px;
  white-space: nowrap;
}
.badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
}
.badge.published {
  background: #e6f6ec;
  color: #1e8e4f;
}
.badge.draft {
  background: var(--bg-deep);
  color: var(--color-text-light);
}
.btn {
  border: 1px solid var(--color-border);
  background: #fff;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
  margin-right: 6px;
}
.btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.btn.primary {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
  margin-right: 0;
}
.btn.primary:hover {
  background: var(--color-primary-dark);
}
.btn.danger:hover {
  border-color: #c0392b;
  color: #c0392b;
}

/* 移动端：表格转卡片，确保新增/编辑/发布/删除入口都可见 */
@media (max-width: 720px) {
  .diary-table,
  .diary-table tbody,
  .diary-table tr,
  .diary-table td {
    display: block;
    width: 100%;
  }
  .diary-table thead {
    display: none;
  }
  .diary-table tr {
    background: var(--color-card);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 12px 14px;
    margin-bottom: 12px;
  }
  .diary-table td {
    border: none;
    padding: 4px 0;
  }
  .title-cell {
    max-width: none;
    white-space: normal;
    font-size: 16px;
    font-weight: 600;
  }
  .slug-cell::before {
    content: 'slug：';
  }
  .cat-cell::before {
    content: '分类：';
  }
  .col-time::before {
    content: '更新时间：';
  }
  .slug-cell,
  .cat-cell,
  .col-time {
    font-size: 13px;
    color: var(--color-text-light);
  }
  .col-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .col-actions .btn {
    margin-right: 0;
    flex: 1;
    text-align: center;
  }
}
</style>
