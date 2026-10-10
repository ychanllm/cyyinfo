<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, apiUpload, getAdminToken } from '../../api';
import AdminListBar from '../../components/AdminListBar.vue';

const { t } = useI18n();
const MAX_FILE = 100 * 1024 * 1024; // 100MB，与后端一致

const items = ref([]);
const total = ref(0);
const page = ref(1);
const size = 20;
const keyword = ref('');
const loading = ref(true);
const uploading = ref(false);
const error = ref('');
const savedId = ref(null);
let feedbackTimer = null;

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await api(`/admin/files?page=${page.value}&size=${size}&q=${encodeURIComponent(keyword.value)}`, { admin: true });
    items.value = data.items;
    total.value = data.total;
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

function onSearch(q) {
  keyword.value = q;
  page.value = 1;
  load();
}

function onPage(p) {
  page.value = p;
  load();
}

async function uploadFiles(event) {
  const picked = Array.from(event.target.files || []);
  event.target.value = '';
  if (!picked.length) return;
  uploading.value = true;
  error.value = '';
  const skipped = [];
  try {
    for (const file of picked) {
      if (file.size > MAX_FILE) {
        skipped.push(t('adminFiles.tooLarge', { name: file.name }));
        continue;
      }
      const form = new FormData();
      form.append('file', file);
      await apiUpload('/admin/files', form);
    }
    await load();
    // load() 内部会清空 error，超限提示必须在 load 之后恢复
    if (skipped.length) error.value = skipped.join('；');
  } catch (e) {
    error.value = e.message;
  } finally {
    uploading.value = false;
  }
}

// 下载需带 Authorization 头，不能直接 <a href>：fetch 拿 blob 再触发浏览器保存
async function download(file) {
  error.value = '';
  try {
    const res = await fetch(`/api/admin/files/${file.id}/download`, {
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.display_name;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    error.value = t('adminFiles.downloadFailed');
  }
}

async function save(file) {
  error.value = '';
  try {
    await api(`/admin/files/${file.id}`, {
      method: 'PUT',
      admin: true,
      body: { display_name: file.display_name, note: file.note || '' },
    });
    savedId.value = file.id;
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => { savedId.value = null; }, 1600);
  } catch (e) {
    error.value = e.message;
  }
}

async function remove(file) {
  if (!confirm(t('adminFiles.confirmDelete', { name: file.display_name }))) return;
  error.value = '';
  try {
    await api(`/admin/files/${file.id}`, { method: 'DELETE', admin: true });
    // 当前页被掏空且不在第一页时回退一页
    if (items.value.length === 1 && page.value > 1) page.value -= 1;
    await load();
  } catch (e) {
    error.value = e.message;
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

onMounted(load);
</script>

<template>
  <div class="files-view">
    <div class="page-head">
      <h2 class="page-title">{{ t('adminFiles.title') }}</h2>
      <label class="btn primary upload-btn">
        {{ uploading ? t('adminFiles.uploading') : t('adminFiles.upload') }}
        <input type="file" multiple class="file-input" :disabled="uploading" @change="uploadFiles" />
      </label>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <section class="card">
      <AdminListBar :total="total" :page="page" :size="size" @search="onSearch" @page="onPage" />
      <p v-if="loading" class="hint">{{ t('adminFiles.loading') }}</p>
      <p v-else-if="!items.length" class="hint">{{ t('adminFiles.empty') }}</p>
      <table v-else class="file-table">
        <thead>
          <tr>
            <th class="col-name">{{ t('adminFiles.name') }}</th>
            <th class="col-note">{{ t('adminFiles.note') }}</th>
            <th class="col-size">{{ t('adminFiles.size') }}</th>
            <th class="col-time">{{ t('adminFiles.time') }}</th>
            <th class="col-actions">{{ t('adminFiles.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="file in items" :key="file.id">
            <td><input v-model="file.display_name" type="text" /></td>
            <td><input v-model="file.note" type="text" :placeholder="t('adminFiles.notePh')" /></td>
            <td class="col-size">{{ formatSize(file.size) }}</td>
            <td class="col-time">{{ file.created_at }}</td>
            <td class="col-actions">
              <button class="btn" @click="save(file)">
                {{ savedId === file.id ? t('adminFiles.saved') : t('adminFiles.save') }}
              </button>
              <button class="btn primary" @click="download(file)">{{ t('adminFiles.download') }}</button>
              <button class="btn danger" @click="remove(file)">{{ t('adminFiles.delete') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.page-head {
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
.upload-btn {
  display: inline-block;
}
.file-input {
  display: none;
}
.file-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  table-layout: fixed;
}
.file-table th {
  text-align: left;
  color: var(--color-text-light);
  font-weight: normal;
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border);
}
.file-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border);
  vertical-align: middle;
}
.file-table input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  outline: none;
}
.file-table input:focus {
  border-color: var(--color-primary);
  background: #fff;
}
.col-name {
  width: 26%;
}
.col-note {
  width: 26%;
}
.col-size {
  width: 90px;
}
.col-time {
  width: 150px;
}
.col-actions {
  width: 220px;
  white-space: nowrap;
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
.col-actions .btn:last-child {
  margin-right: 0;
}
@media (max-width: 600px) {
  .col-time {
    display: none;
  }
  .col-actions {
    width: 84px;
    white-space: normal;
  }
  .col-actions .btn {
    display: block;
    width: 100%;
    margin: 0 0 6px;
    padding: 4px 6px;
    box-sizing: border-box;
  }
  .col-actions .btn:last-child {
    margin-bottom: 0;
  }
}
</style>
