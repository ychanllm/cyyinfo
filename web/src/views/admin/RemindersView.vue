<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../../api';

const reminders = ref([]);
const loading = ref(true);
const error = ref('');
const saving = ref(false);
const formOpen = ref(false);
const editingId = ref(null);

const formTitle = ref('');
const formContent = ref('');
const formSendAt = ref('');
const formRecipient = ref('');

function statusText(s) {
  return s === 'sent' ? '已发送' : s === 'failed' ? '失败' : '待发送';
}

function fmtTime(s) {
  if (!s) return '—';
  return String(s).slice(0, 16);
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    reminders.value = await api('/admin/reminders', { admin: true });
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editingId.value = null;
  formTitle.value = '';
  formContent.value = '';
  formSendAt.value = '';
  formRecipient.value = '';
  formOpen.value = true;
}
function openEdit(r) {
  editingId.value = r.id;
  formTitle.value = r.title;
  formContent.value = r.content || '';
  formSendAt.value = r.send_at ? r.send_at.replace(' ', 'T') : '';
  formRecipient.value = r.recipient || '';
  formOpen.value = true;
}

async function save() {
  if (!formTitle.value.trim() || !formSendAt.value) {
    error.value = '标题和发送时间必填';
    return;
  }
  saving.value = true;
  error.value = '';
  const payload = {
    title: formTitle.value.trim(),
    content: formContent.value,
    send_at: formSendAt.value.replace('T', ' '),
    recipient: formRecipient.value.trim(),
  };
  try {
    if (editingId.value) {
      await api(`/admin/reminders/${editingId.value}`, { method: 'PUT', admin: true, body: payload });
    } else {
      await api('/admin/reminders', { method: 'POST', admin: true, body: payload });
    }
    formOpen.value = false;
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

async function remove(r) {
  if (!confirm(`确定删除提醒「${r.title}」吗？`)) return;
  try {
    await api(`/admin/reminders/${r.id}`, { method: 'DELETE', admin: true });
    await load();
  } catch (e) {
    error.value = e.message;
  }
}

onMounted(load);
</script>

<template>
  <div class="reminders-view">
    <div class="head">
      <h2 class="page-title">提醒事项</h2>
      <button class="btn primary" @click="openCreate">新增提醒</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="hint">加载中…</p>

    <section class="card">
      <p v-if="!loading && !reminders.length" class="hint">还没有提醒，点「新增提醒」创建。到点后会自动发邮件。</p>
      <ul v-else class="list">
        <li v-for="r in reminders" :key="r.id" class="item">
          <div class="info">
            <span class="title">{{ r.title }}</span>
            <span class="badge" :class="r.status">{{ statusText(r.status) }}</span>
          </div>
          <p class="time">{{ fmtTime(r.send_at) }}<template v-if="r.recipient"> · {{ r.recipient }}</template></p>
          <p v-if="r.content" class="content">{{ r.content }}</p>
          <p v-if="r.status === 'failed' && r.error" class="fail-err">发送失败：{{ r.error }}</p>
          <div class="actions">
            <button class="btn" @click="openEdit(r)">编辑</button>
            <button class="btn danger" @click="remove(r)">删除</button>
          </div>
        </li>
      </ul>
    </section>

    <div v-if="formOpen" class="modal">
      <form class="form-card" @submit.prevent="save">
        <h3>{{ editingId ? '编辑提醒' : '新增提醒' }}</h3>
        <label class="field">
          标题
          <input v-model="formTitle" type="text" placeholder="提醒标题" />
        </label>
        <label class="field">
          内容（邮件正文，留空则只发标题）
          <textarea v-model="formContent" rows="3" placeholder="到点想说的话…"></textarea>
        </label>
        <label class="field">
          发送时间（到点自动发邮件）
          <input v-model="formSendAt" type="datetime-local" />
        </label>
        <label class="field">
          收件邮箱（留空用设置里的默认收件人）
          <input v-model="formRecipient" type="email" placeholder="xxx@qq.com" />
        </label>
        <div class="actions">
          <button type="button" class="btn" @click="formOpen = false">取消</button>
          <button type="submit" class="btn primary" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button>
        </div>
      </form>
    </div>
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
.hint {
  color: var(--color-text-light);
  font-size: 14px;
}
.card {
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 20px 24px;
}
.list {
  list-style: none;
}
.item {
  border-bottom: 1px solid var(--color-border);
  padding: 12px 0;
}
.item:last-child {
  border-bottom: none;
}
.info {
  display: flex;
  align-items: center;
  gap: 10px;
}
.title {
  font-size: 16px;
  font-weight: 600;
}
.time {
  font-size: 13px;
  color: var(--color-text-light);
  margin-top: 4px;
}
.content {
  font-size: 14px;
  color: var(--color-text);
  margin-top: 4px;
}
.fail-err {
  font-size: 13px;
  color: #c0392b;
  margin-top: 4px;
}
.badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
}
.badge.pending {
  background: var(--bg-deep);
  color: var(--color-text-light);
}
.badge.sent {
  background: #e6f6ec;
  color: #1e8e4f;
}
.badge.failed {
  background: #fdecec;
  color: #c0392b;
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.btn {
  border: 1px solid var(--color-border);
  background: #fff;
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
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
.modal {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(30, 24, 18, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.form-card {
  width: 100%;
  max-width: 420px;
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 24px;
}
.form-card h3 {
  margin-bottom: 16px;
}
.field {
  display: block;
  font-size: 13px;
  color: var(--color-text-light);
  margin-bottom: 14px;
}
.field input,
.field textarea {
  display: block;
  width: 100%;
  margin-top: 4px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: 14px;
  outline: none;
}
.field textarea {
  resize: vertical;
}
.field input:focus,
.field textarea:focus {
  border-color: var(--color-primary);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
</style>
