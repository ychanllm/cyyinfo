<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../../api';

const { t } = useI18n();

const stores = ref([]);
const loading = ref(false);
const error = ref('');

// ---- 门店新建 / 编辑 ----
const formOpen = ref(false);
const editingId = ref(null);
const formName = ref('');
const formAddress = ref('');
const formNote = ref('');
const formFile = ref(null);
const saving = ref(false);
const formError = ref('');

// ---- 店内菜品展开管理：store id 集合 ----
const expanded = ref(new Set());
const addName = ref('');
const addNote = ref('');
const adding = ref(false);
// 菜品行内编辑态：dishId -> { name, note }
const editingDish = ref(new Map());
const dishSaving = ref(new Map());

async function load() {
  loading.value = true;
  error.value = '';
  try {
    stores.value = await api('/admin/stores', { admin: true });
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
  formAddress.value = '';
  formNote.value = '';
  formFile.value = null;
  formError.value = '';
  formOpen.value = true;
}

function openEdit(s) {
  editingId.value = s.id;
  formName.value = s.name;
  formAddress.value = s.address || '';
  formNote.value = s.note || '';
  formFile.value = null;
  formError.value = '';
  formOpen.value = true;
}

function onFileChange(e) {
  formFile.value = e.target.files?.[0] || null;
}

async function save() {
  if (!formName.value.trim()) {
    formError.value = t('adminStores.nameRequired');
    return;
  }
  saving.value = true;
  formError.value = '';
  try {
    const form = new FormData();
    form.append('name', formName.value.trim());
    form.append('address', formAddress.value.trim());
    form.append('note', formNote.value.trim());
    if (formFile.value) form.append('image', formFile.value);
    if (editingId.value) {
      await api(`/admin/stores/${editingId.value}`, { method: 'PUT', admin: true, form });
    } else {
      await api('/admin/stores', { method: 'POST', admin: true, form });
    }
    formOpen.value = false;
    await load();
  } catch (e) {
    formError.value = e.message;
  } finally {
    saving.value = false;
  }
}

async function toggleActive(s) {
  try {
    await api(`/admin/stores/${s.id}`, {
      method: 'PUT',
      admin: true,
      body: { is_active: s.is_active ? 0 : 1 },
    });
    await load();
  } catch (e) {
    error.value = e.message;
  }
}

async function remove(s) {
  if (!confirm(t('adminStores.confirmDelete', { name: s.name }))) return;
  try {
    await api(`/admin/stores/${s.id}`, { method: 'DELETE', admin: true });
    await load();
  } catch (e) {
    error.value = e.message;
  }
}

// ---- 店内菜品 ----
async function addDish(storeId) {
  const name = addName.value.trim();
  if (!name) return;
  adding.value = true;
  try {
    await api(`/admin/stores/${storeId}/dishes`, {
      method: 'POST',
      admin: true,
      body: { name, note: addNote.value.trim() },
    });
    addName.value = '';
    addNote.value = '';
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    adding.value = false;
  }
}

function startEditDish(d) {
  const m = new Map(editingDish.value);
  m.set(d.id, { name: d.name, note: d.note || '' });
  editingDish.value = m;
}

function cancelEditDish(id) {
  const m = new Map(editingDish.value);
  m.delete(id);
  editingDish.value = m;
}

async function saveDish(storeId, dishId) {
  const edit = editingDish.value.get(dishId);
  if (!edit || !edit.name.trim()) return;
  dishSaving.value = new Map(dishSaving.value).set(dishId, true);
  try {
    await api(`/admin/stores/${storeId}/dishes/${dishId}`, {
      method: 'PUT',
      admin: true,
      body: { name: edit.name.trim(), note: edit.note.trim() },
    });
    cancelEditDish(dishId);
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    dishSaving.value = new Map(dishSaving.value).set(dishId, false);
  }
}

async function removeDish(storeId, d) {
  if (!confirm(t('adminStores.confirmDeleteDish', { name: d.name }))) return;
  try {
    await api(`/admin/stores/${storeId}/dishes/${d.id}`, { method: 'DELETE', admin: true });
    await load();
  } catch (e) {
    error.value = e.message;
  }
}
</script>

<template>
  <div class="stores-view">
    <div class="head">
      <h2 class="page-title">{{ t('adminStores.title') }}</h2>
      <button class="btn primary" @click="openCreate">{{ t('adminStores.new') }}</button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="hint">{{ t('adminStores.loading') }}</p>

    <section class="card">
      <p v-if="!loading && !stores.length" class="hint">{{ t('adminStores.empty') }}</p>
      <ul v-else class="list">
        <li v-for="s in stores" :key="s.id" class="item" :class="{ inactive: !s.is_active }">
          <img v-if="s.image" :src="`/uploads/${s.image}`" class="thumb" :alt="s.name" />
          <span v-else class="thumb placeholder">🏮</span>
          <div class="info">
            <div class="line">
              <span class="name">{{ s.name }}</span>
              <span v-if="!s.is_active" class="badge off">{{ t('adminStores.inactive') }}</span>
            </div>
            <p v-if="s.address" class="addr">📍 {{ s.address }}</p>
            <p v-if="s.note" class="desc">{{ s.note }}</p>
            <div class="line sub">
              <span>{{ t('adminStores.createdBy') }}：{{ s.created_by_username || t('adminStores.byAdmin') }}</span>
              <button class="want-toggle" @click="toggleExpand(s.id)">
                {{ t('adminStores.dishesTitle') }}（{{ s.dishes.length }}）
                {{ expanded.has(s.id) ? '▲' : '▼' }}
              </button>
            </div>

            <div v-if="expanded.has(s.id)" class="dishes-panel">
              <ul class="dish-list">
                <li v-for="d in s.dishes" :key="d.id" class="dish-item">
                  <template v-if="editingDish.has(d.id)">
                    <input
                      v-model="editingDish.get(d.id).name"
                      class="dish-name-input"
                      maxlength="50"
                      :placeholder="t('adminStores.dishNamePh')"
                    />
                    <input
                      v-model="editingDish.get(d.id).note"
                      class="dish-note-input"
                      maxlength="100"
                      :placeholder="t('adminStores.dishNotePh')"
                    />
                    <button class="btn" :disabled="dishSaving.get(d.id)" @click="saveDish(s.id, d.id)">
                      {{ t('adminStores.dishSave') }}
                    </button>
                    <button class="btn" @click="cancelEditDish(d.id)">{{ t('adminStores.cancel') }}</button>
                  </template>
                  <template v-else>
                    <span class="dish-name">{{ d.name }}</span>
                    <span v-if="d.note" class="dish-note">{{ d.note }}</span>
                    <button class="btn" @click="startEditDish(d)">{{ t('adminStores.edit') }}</button>
                    <button class="btn danger" @click="removeDish(s.id, d)">{{ t('adminStores.delete') }}</button>
                  </template>
                </li>
              </ul>
              <div class="add-dish">
                <input
                  v-model="addName"
                  class="dish-name-input"
                  maxlength="50"
                  :placeholder="t('adminStores.dishNamePh')"
                  @keyup.enter="addDish(s.id)"
                />
                <input
                  v-model="addNote"
                  class="dish-note-input"
                  maxlength="100"
                  :placeholder="t('adminStores.dishNotePh')"
                  @keyup.enter="addDish(s.id)"
                />
                <button class="btn primary" :disabled="adding" @click="addDish(s.id)">
                  {{ adding ? t('adminStores.addingDish') : t('adminStores.addDish') }}
                </button>
              </div>
            </div>
          </div>
          <div class="actions">
            <button class="btn" @click="openEdit(s)">{{ t('adminStores.edit') }}</button>
            <button class="btn" @click="toggleActive(s)">
              {{ s.is_active ? t('adminStores.off') : t('adminStores.restore') }}
            </button>
            <button class="btn danger" @click="remove(s)">{{ t('adminStores.delete') }}</button>
          </div>
        </li>
      </ul>
    </section>

    <div v-if="formOpen" class="modal" @click.self="formOpen = false">
      <form class="form-card" @submit.prevent="save">
        <h3>{{ editingId ? t('adminStores.editTitle') : t('adminStores.newTitle') }}</h3>
        <label class="field">
          {{ t('adminStores.name') }}
          <input v-model="formName" type="text" maxlength="50" :placeholder="t('adminStores.namePh')" />
        </label>
        <label class="field">
          {{ t('adminStores.address') }}
          <input v-model="formAddress" type="text" maxlength="100" :placeholder="t('adminStores.addressPh')" />
        </label>
        <label class="field">
          {{ t('adminStores.note') }}
          <textarea v-model="formNote" rows="3" maxlength="300" :placeholder="t('adminStores.notePh')"></textarea>
        </label>
        <label class="field">
          {{ t('adminStores.image') }}
          <input type="file" accept="image/*" @change="onFileChange" />
          <span v-if="editingId" class="field-hint">{{ t('adminStores.imageHint') }}</span>
        </label>
        <p v-if="formError" class="error">{{ formError }}</p>
        <div class="actions">
          <button type="button" class="btn" @click="formOpen = false">{{ t('adminStores.cancel') }}</button>
          <button type="submit" class="btn primary" :disabled="saving">
            {{ saving ? t('adminStores.saving') : t('adminStores.save') }}
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
.addr {
  font-size: 13px;
  color: var(--color-text-light);
  margin-top: 2px;
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
.dishes-panel {
  margin-top: 10px;
  background: var(--bg-deep);
  border-radius: 8px;
  padding: 10px;
}
.dish-list {
  list-style: none;
}
.dish-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--color-border);
  flex-wrap: wrap;
}
.dish-item:last-child {
  border-bottom: none;
}
.dish-name {
  font-size: 14px;
}
.dish-note {
  font-size: 12px;
  color: var(--color-text-light);
}
.dish-name-input,
.dish-note-input {
  flex: 1;
  min-width: 120px;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  outline: none;
}
.dish-note-input {
  flex: 2;
}
.add-dish {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--color-border);
  flex-wrap: wrap;
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
