<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../../api';

const { t } = useI18n();

const dishes = ref([]);
const loading = ref(false);
const error = ref('');

// ---- 新建 / 编辑表单 ----
const formOpen = ref(false);
const editingId = ref(null);
const formName = ref('');
const formDesc = ref('');
const formFile = ref(null);
const saving = ref(false);
const formError = ref('');

// 想吃明细展开：dish id 集合
const expanded = ref(new Set());

async function load() {
  loading.value = true;
  error.value = '';
  try {
    dishes.value = await api('/admin/dishes', { admin: true });
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function toggleExpand(id) {
  const s = new Set(expanded.value);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  expanded.value = s;
}

function openCreate() {
  editingId.value = null;
  formName.value = '';
  formDesc.value = '';
  formFile.value = null;
  formError.value = '';
  formOpen.value = true;
}

function openEdit(d) {
  editingId.value = d.id;
  formName.value = d.name;
  formDesc.value = d.description || '';
  formFile.value = null;
  formError.value = '';
  formOpen.value = true;
}

function onFileChange(e) {
  formFile.value = e.target.files?.[0] || null;
}

async function save() {
  if (!formName.value.trim()) {
    formError.value = t('adminDishes.nameRequired');
    return;
  }
  saving.value = true;
  formError.value = '';
  try {
    const form = new FormData();
    form.append('name', formName.value.trim());
    form.append('description', formDesc.value.trim());
    if (formFile.value) form.append('image', formFile.value);
    if (editingId.value) {
      await api(`/admin/dishes/${editingId.value}`, { method: 'PUT', admin: true, form });
    } else {
      await api('/admin/dishes', { method: 'POST', admin: true, form });
    }
    formOpen.value = false;
    await load();
  } catch (e) {
    formError.value = e.message;
  } finally {
    saving.value = false;
  }
}

async function toggleActive(d) {
  try {
    await api(`/admin/dishes/${d.id}`, {
      method: 'PUT',
      admin: true,
      body: { is_active: d.is_active ? 0 : 1 },
    });
    await load();
  } catch (e) {
    error.value = e.message;
  }
}

async function remove(d) {
  if (!confirm(t('adminDishes.confirmDelete', { name: d.name }))) return;
  try {
    await api(`/admin/dishes/${d.id}`, { method: 'DELETE', admin: true });
    await load();
  } catch (e) {
    error.value = e.message;
  }
}
</script>

<template>
  <div class="dishes-view">
    <div class="head">
      <h2 class="page-title">{{ t('adminDishes.title') }}</h2>
      <button class="btn primary" @click="openCreate">{{ t('adminDishes.new') }}</button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="hint">{{ t('adminDishes.loading') }}</p>

    <section class="card">
      <p v-if="!loading && !dishes.length" class="hint">{{ t('adminDishes.empty') }}</p>
      <ul v-else class="list">
        <li v-for="d in dishes" :key="d.id" class="item" :class="{ inactive: !d.is_active }">
          <img v-if="d.image" :src="`/uploads/${d.image}`" class="thumb" :alt="d.name" />
          <span v-else class="thumb placeholder">🍲</span>
          <div class="info">
            <div class="line">
              <span class="name">{{ d.name }}</span>
              <span v-if="!d.is_active" class="badge off">{{ t('adminDishes.inactive') }}</span>
            </div>
            <p v-if="d.description" class="desc">{{ d.description }}</p>
            <div class="line sub">
              <span>{{ t('adminDishes.createdBy') }}：{{ d.created_by_username || t('adminDishes.byAdmin') }}</span>
              <button class="want-toggle" @click="toggleExpand(d.id)">
                {{ t('adminDishes.wantCount', { n: d.want_count }) }}
                {{ d.want_count ? (expanded.has(d.id) ? '▲' : '▼') : '' }}
              </button>
            </div>
            <p v-if="expanded.has(d.id) && d.want_usernames.length" class="want-users">
              {{ d.want_usernames.join('、') }}
            </p>
          </div>
          <div class="actions">
            <button class="btn" @click="openEdit(d)">{{ t('adminDishes.edit') }}</button>
            <button class="btn" @click="toggleActive(d)">
              {{ d.is_active ? t('adminDishes.off') : t('adminDishes.restore') }}
            </button>
            <button class="btn danger" @click="remove(d)">{{ t('adminDishes.delete') }}</button>
          </div>
        </li>
      </ul>
    </section>

    <div v-if="formOpen" class="modal" @click.self="formOpen = false">
      <form class="form-card" @submit.prevent="save">
        <h3>{{ editingId ? t('adminDishes.editTitle') : t('adminDishes.newTitle') }}</h3>
        <label class="field">
          {{ t('adminDishes.name') }}
          <input v-model="formName" type="text" maxlength="50" :placeholder="t('adminDishes.namePh')" />
        </label>
        <label class="field">
          {{ t('adminDishes.desc') }}
          <textarea v-model="formDesc" rows="3" maxlength="200" :placeholder="t('adminDishes.descPh')"></textarea>
        </label>
        <label class="field">
          {{ t('adminDishes.image') }}
          <input type="file" accept="image/*" @change="onFileChange" />
          <span v-if="editingId" class="field-hint">{{ t('adminDishes.imageHint') }}</span>
        </label>
        <p v-if="formError" class="error">{{ formError }}</p>
        <div class="actions">
          <button type="button" class="btn" @click="formOpen = false">{{ t('adminDishes.cancel') }}</button>
          <button type="submit" class="btn primary" :disabled="saving">
            {{ saving ? t('adminDishes.saving') : t('adminDishes.save') }}
          </button>
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
  display: flex;
  align-items: flex-start;
  gap: 14px;
  border-bottom: 1px solid var(--color-border);
  padding: 14px 0;
}
.item:last-child {
  border-bottom: none;
}
.item.inactive .info {
  opacity: 0.55;
}
.thumb {
  width: 64px;
  height: 64px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
}
.thumb.placeholder {
  background: var(--bg-deep);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
}
.info {
  flex: 1;
  min-width: 0;
}
.line {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.name {
  font-size: 16px;
  font-weight: 600;
}
.badge.off {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  background: var(--bg-deep);
  color: var(--color-text-light);
}
.desc {
  font-size: 13px;
  color: var(--color-text-light);
  margin-top: 2px;
}
.line.sub {
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-text-light);
}
.want-toggle {
  border: none;
  background: none;
  color: var(--color-primary);
  font-size: 13px;
  cursor: pointer;
  padding: 0;
}
.want-users {
  margin-top: 4px;
  font-size: 13px;
  color: var(--color-text);
  background: var(--bg-deep);
  border-radius: 8px;
  padding: 6px 10px;
}
.actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
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
.field input[type='file'] {
  padding: 6px 0;
  border: none;
}
.field textarea {
  resize: vertical;
}
.field input:focus,
.field textarea:focus {
  border-color: var(--color-primary);
}
.field-hint {
  display: block;
  margin-top: 4px;
  font-size: 12px;
}
.form-card .actions {
  justify-content: flex-end;
}
@media (max-width: 720px) {
  .item {
    flex-wrap: wrap;
  }
  .actions {
    width: 100%;
  }
}
</style>
