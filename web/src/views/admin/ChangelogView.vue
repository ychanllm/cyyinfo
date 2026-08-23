<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../../api';

const { t } = useI18n();

const tab = ref('versions'); // versions | audit
const loading = ref(false);
const error = ref('');
const saving = ref(false);

// ---- 版本更新 ----
const changelogs = ref([]);
const formOpen = ref(false);
const editingId = ref(null);
const formVersion = ref('');
const formContent = ref('');

// ---- 数据变动 ----
const auditLogs = ref([]);
const auditType = ref('');      // 类型筛选，空 = 全部
const auditHasMore = ref(false);
const AUDIT_PAGE = 50;

const TYPE_KEYS = {
  user_register: 'typeUserRegister',
  user_login: 'typeUserLogin',
  avatar_update: 'typeAvatarUpdate',
  password_reset: 'typePasswordReset',
  user_create: 'typeUserCreate',
  user_delete: 'typeUserDelete',
  admin_login: 'typeAdminLogin',
  like: 'typeLike',
  unlike: 'typeUnlike',
  like_burst: 'typeLikeBurst',
  message_post: 'typeMessagePost',
  message_review: 'typeMessageReview',
  checkin: 'typeCheckin',
  box_draw: 'typeBoxDraw',
  redeem: 'typeRedeem',
  prize_use: 'typePrizeUse',
  photo_upload: 'typePhotoUpload',
  photo_delete: 'typePhotoDelete',
  photo_hide: 'typePhotoHide',
  photo_unhide: 'typePhotoUnhide',
  album_create: 'typeAlbumCreate',
  album_update: 'typeAlbumUpdate',
  album_delete: 'typeAlbumDelete',
  diary_create: 'typeDiaryCreate',
  diary_update: 'typeDiaryUpdate',
  diary_delete: 'typeDiaryDelete',
  music_create: 'typeMusicCreate',
  music_delete: 'typeMusicDelete',
  settings_update: 'typeSettingsUpdate',
  prize_create: 'typePrizeCreate',
  prize_update: 'typePrizeUpdate',
  prize_delete: 'typePrizeDelete',
  prize_record_use: 'typePrizeRecordUse',
  prize_record_cancel: 'typePrizeRecordCancel',
};

function typeLabel(type) {
  const key = TYPE_KEYS[type];
  return key ? t(`adminChangelog.${key}`) : type;
}

function fmtTime(s) {
  if (!s) return '—';
  return String(s).slice(0, 16);
}

// 数据变动：类型筛选 + offset 分页（「加载更多」追加）
async function loadAudit(append = false) {
  const params = new URLSearchParams();
  if (auditType.value) params.set('type', auditType.value);
  params.set('offset', String(append ? auditLogs.value.length : 0));
  params.set('limit', String(AUDIT_PAGE));
  const items = await api(`/admin/audit-logs?${params}`, { admin: true });
  auditLogs.value = append ? [...auditLogs.value, ...items] : items;
  auditHasMore.value = items.length === AUDIT_PAGE;
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    if (tab.value === 'versions') {
      changelogs.value = await api('/admin/changelogs', { admin: true });
    } else {
      await loadAudit(false);
    }
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function loadMoreAudit() {
  error.value = '';
  try {
    await loadAudit(true);
  } catch (e) {
    error.value = e.message;
  }
}

function switchTab(name) {
  tab.value = name;
  load();
}

function openCreate() {
  editingId.value = null;
  formVersion.value = '';
  formContent.value = '';
  formOpen.value = true;
}
function openEdit(r) {
  editingId.value = r.id;
  formVersion.value = r.version;
  formContent.value = r.content || '';
  formOpen.value = true;
}

async function save() {
  if (!formVersion.value.trim()) {
    error.value = t('adminChangelog.required');
    return;
  }
  saving.value = true;
  error.value = '';
  const payload = { version: formVersion.value.trim(), content: formContent.value };
  try {
    if (editingId.value) {
      await api(`/admin/changelogs/${editingId.value}`, { method: 'PUT', admin: true, body: payload });
    } else {
      await api('/admin/changelogs', { method: 'POST', admin: true, body: payload });
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
  if (!confirm(t('adminChangelog.confirmDelete', { version: r.version }))) return;
  try {
    await api(`/admin/changelogs/${r.id}`, { method: 'DELETE', admin: true });
    await load();
  } catch (e) {
    error.value = e.message;
  }
}

onMounted(load);
</script>

<template>
  <div class="changelog-view">
    <div class="head">
      <h2 class="page-title">{{ t('adminChangelog.title') }}</h2>
      <button v-if="tab === 'versions'" class="btn primary" @click="openCreate">{{ t('adminChangelog.new') }}</button>
    </div>

    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'versions' }" @click="switchTab('versions')">
        {{ t('adminChangelog.tabVersions') }}
      </button>
      <button class="tab" :class="{ active: tab === 'audit' }" @click="switchTab('audit')">
        {{ t('adminChangelog.tabAudit') }}
      </button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="hint">{{ t('adminChangelog.loading') }}</p>

    <section v-if="tab === 'versions'" class="card">
      <p v-if="!loading && !changelogs.length" class="hint">{{ t('adminChangelog.emptyVersions') }}</p>
      <ul v-else class="list">
        <li v-for="r in changelogs" :key="r.id" class="item">
          <div class="info">
            <span class="version">{{ r.version }}</span>
            <span class="time">{{ fmtTime(r.created_at) }}</span>
          </div>
          <p v-if="r.content" class="content">{{ r.content }}</p>
          <div class="actions">
            <button class="btn" @click="openEdit(r)">{{ t('adminChangelog.edit') }}</button>
            <button class="btn danger" @click="remove(r)">{{ t('adminChangelog.delete') }}</button>
          </div>
        </li>
      </ul>
    </section>

    <section v-else class="card">
      <div class="audit-toolbar">
        <select v-model="auditType" @change="load">
          <option value="">{{ t('adminChangelog.filterAll') }}</option>
          <option v-for="(key, type) in TYPE_KEYS" :key="type" :value="type">
            {{ t(`adminChangelog.${key}`) }}
          </option>
        </select>
      </div>
      <p v-if="!loading && !auditLogs.length" class="hint">{{ t('adminChangelog.emptyAudit') }}</p>
      <ul v-else class="list">
        <li v-for="r in auditLogs" :key="r.id" class="item">
          <div class="info">
            <span class="badge">{{ typeLabel(r.type) }}</span>
            <span v-if="r.actor" class="actor">{{ r.actor }}</span>
            <span class="time">{{ fmtTime(r.created_at) }}</span>
          </div>
          <p v-if="r.detail" class="content">{{ r.detail }}</p>
        </li>
      </ul>
      <button v-if="auditHasMore" class="btn load-more" :disabled="loading" @click="loadMoreAudit">
        {{ t('adminChangelog.loadMore') }}
      </button>
    </section>

    <div v-if="formOpen" class="modal">
      <form class="form-card" @submit.prevent="save">
        <h3>{{ editingId ? t('adminChangelog.editTitle') : t('adminChangelog.newTitle') }}</h3>
        <label class="field">
          {{ t('adminChangelog.version') }}
          <input v-model="formVersion" type="text" :placeholder="t('adminChangelog.versionPh')" />
        </label>
        <label class="field">
          {{ t('adminChangelog.content') }}
          <textarea v-model="formContent" rows="4" :placeholder="t('adminChangelog.contentPh')"></textarea>
        </label>
        <div class="actions">
          <button type="button" class="btn" @click="formOpen = false">{{ t('adminChangelog.cancel') }}</button>
          <button type="submit" class="btn primary" :disabled="saving">{{ saving ? t('adminChangelog.saving') : t('adminChangelog.save') }}</button>
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
  margin-bottom: 16px;
}
.page-title {
  font-size: 22px;
}
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}
.tab {
  border: 1px solid var(--color-border);
  background: #fff;
  border-radius: 999px;
  padding: 6px 18px;
  font-size: 14px;
  color: var(--color-text);
  cursor: pointer;
}
.tab.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
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
.audit-toolbar {
  margin-bottom: 12px;
}
.audit-toolbar select {
  padding: 6px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: 14px;
  background: #fff;
  outline: none;
}
.audit-toolbar select:focus {
  border-color: var(--color-primary);
}
.load-more {
  display: block;
  margin: 12px auto 0;
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
.version {
  font-size: 16px;
  font-weight: 600;
}
.badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  background: var(--bg-deep);
  color: var(--color-text-light);
}
.actor {
  font-size: 13px;
  color: var(--color-text);
}
.time {
  font-size: 13px;
  color: var(--color-text-light);
}
.content {
  font-size: 14px;
  color: var(--color-text);
  margin-top: 4px;
  white-space: pre-wrap;
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
.form-card .actions {
  justify-content: flex-end;
}
</style>
