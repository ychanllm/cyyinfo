<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../../api';

const tab = ref('pending'); // pending | all
const messages = ref([]);
const loading = ref(true);
const error = ref('');

async function loadMessages() {
  loading.value = true;
  error.value = '';
  try {
    const query = tab.value === 'pending' ? '?pending=1' : '';
    messages.value = await api(`/admin/messages${query}`, { admin: true });
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

function switchTab(t) {
  if (tab.value === t) return;
  tab.value = t;
  loadMessages();
}

async function approve(msg) {
  error.value = '';
  try {
    await api(`/admin/messages/${msg.id}/approve`, { method: 'POST', admin: true });
    await loadMessages();
  } catch (e) {
    error.value = e.message;
  }
}

async function remove(msg) {
  if (!confirm(`确定删除「${msg.nickname}」的这条留言吗？`)) return;
  error.value = '';
  try {
    await api(`/admin/messages/${msg.id}`, { method: 'DELETE', admin: true });
    await loadMessages();
  } catch (e) {
    error.value = e.message;
  }
}

function targetLabel(msg) {
  if (msg.target_type === 'diary') return `日记 #${msg.target_id}`;
  if (msg.target_type === 'photo') return `照片 #${msg.target_id}`;
  return '全站';
}

function fmtTime(s) {
  if (!s) return '—';
  const d = new Date(s.endsWith('Z') || s.includes('+') ? s : `${s.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return s;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

onMounted(loadMessages);
</script>

<template>
  <div class="messages-view">
    <h2 class="page-title">留言审核</h2>
    <p v-if="error" class="error">{{ error }}</p>

    <section class="card">
      <div class="tabs">
        <button class="tab" :class="{ active: tab === 'pending' }" @click="switchTab('pending')">
          待审核
        </button>
        <button class="tab" :class="{ active: tab === 'all' }" @click="switchTab('all')">
          全部
        </button>
      </div>

      <p v-if="loading" class="hint">加载中…</p>
      <p v-else-if="!messages.length" class="hint">
        {{ tab === 'pending' ? '没有待审核的留言' : '还没有留言' }}
      </p>
      <table v-else class="message-table">
        <thead>
          <tr>
            <th class="col-nick">昵称</th>
            <th>内容</th>
            <th class="col-target">目标</th>
            <th v-if="tab === 'all'" class="col-status">状态</th>
            <th class="col-time">时间</th>
            <th class="col-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="msg in messages" :key="msg.id">
            <td class="col-nick">{{ msg.nickname }}</td>
            <td class="content-cell">{{ msg.content }}</td>
            <td class="col-target">{{ targetLabel(msg) }}</td>
            <td v-if="tab === 'all'" class="col-status">
              <span class="badge" :class="msg.is_approved ? 'approved' : 'pending'">
                {{ msg.is_approved ? '已通过' : '待审核' }}
              </span>
            </td>
            <td class="col-time">{{ fmtTime(msg.created_at) }}</td>
            <td class="col-actions">
              <button v-if="!msg.is_approved" class="btn primary" @click="approve(msg)">批准</button>
              <button class="btn danger" @click="remove(msg)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.page-title {
  font-size: 22px;
  margin-bottom: 20px;
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
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.tab {
  border: 1px solid var(--color-border);
  background: #fff;
  border-radius: 6px;
  padding: 6px 16px;
  font-size: 14px;
  color: var(--color-text);
  cursor: pointer;
}
.tab.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
.message-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.message-table th {
  text-align: left;
  color: var(--color-text-light);
  font-weight: normal;
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border);
}
.message-table td {
  padding: 10px 8px;
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
}
.col-nick {
  width: 110px;
}
.content-cell {
  max-width: 360px;
  white-space: pre-wrap;
  word-break: break-word;
}
.col-target {
  width: 100px;
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
  width: 150px;
  white-space: nowrap;
}
.badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
}
.badge.approved {
  background: #e6f6ec;
  color: #1e8e4f;
}
.badge.pending {
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
}
.btn.primary:hover {
  background: var(--color-primary-dark);
}
.btn.danger:hover {
  border-color: #c0392b;
  color: #c0392b;
}
</style>
