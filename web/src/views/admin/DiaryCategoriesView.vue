<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../../api';

const { t } = useI18n();
const categories = ref([]);
const loading = ref(true);
const error = ref('');

// 添加
const newName = ref('');
const newNameEn = ref('');
const adding = ref(false);

// 行内重命名
const editingId = ref(null); // 正在编辑的分类 id
const editName = ref('');
const editNameEn = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    categories.value = await api('/admin/diary-categories', { admin: true });
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function add() {
  const name = newName.value.trim();
  if (!name) return;
  adding.value = true;
  error.value = '';
  try {
    await api('/admin/diary-categories', { method: 'POST', admin: true, body: { name, name_en: newNameEn.value.trim() } });
    newName.value = '';
    newNameEn.value = '';
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    adding.value = false;
  }
}

function startRename(cat) {
  editingId.value = cat.id;
  editName.value = cat.name;
  editNameEn.value = cat.name_en || '';
}

async function saveRename(cat) {
  const name = editName.value.trim();
  if (!name) {
    error.value = t('adminCategories.nameRequired');
    return;
  }
  error.value = '';
  try {
    await api(`/admin/diary-categories/${cat.id}`, { method: 'PUT', admin: true, body: { name, name_en: editNameEn.value.trim() } });
    editingId.value = null;
    await load();
  } catch (e) {
    error.value = e.message;
  }
}

async function remove(cat) {
  if (!confirm(t('adminCategories.confirmDelete', { name: cat.name, count: cat.count }))) return;
  error.value = '';
  try {
    await api(`/admin/diary-categories/${cat.id}`, { method: 'DELETE', admin: true });
    await load();
  } catch (e) {
    error.value = e.message;
  }
}

onMounted(load);
</script>

<template>
  <div class="categories-view">
    <div class="head">
      <h2 class="page-title">{{ t('adminCategories.title') }}</h2>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="add-row">
      <input
        v-model="newName"
        type="text"
        :placeholder="t('adminCategories.newNameZh')"
        class="name-input"
        @keyup.enter="add"
      />
      <input
        v-model="newNameEn"
        type="text"
        :placeholder="t('adminCategories.newNameEn')"
        class="name-input en-input"
        @keyup.enter="add"
      />
      <button class="btn primary" :disabled="adding || !newName.trim()" @click="add">
        {{ adding ? t('adminCategories.adding') : t('adminCategories.add') }}
      </button>
    </div>

    <section class="card">
      <p v-if="loading" class="hint">{{ t('adminCategories.loading') }}</p>
      <p v-else-if="!categories.length" class="hint">{{ t('adminCategories.empty') }}</p>
      <ul v-else class="cat-list">
        <li v-for="cat in categories" :key="cat.id" class="cat-item">
          <template v-if="editingId === cat.id">
            <input
              v-model="editName"
              type="text"
              class="name-input"
              @keyup.enter="saveRename(cat)"
            />
            <input
              v-model="editNameEn"
              type="text"
              class="name-input en-input"
              @keyup.enter="saveRename(cat)"
            />
            <button class="btn" @click="saveRename(cat)">{{ t('adminCategories.save') }}</button>
            <button class="btn" @click="editingId = null">{{ t('adminCategories.cancel') }}</button>
          </template>
          <template v-else>
            <span class="cat-name">{{ cat.name }}</span>
            <span class="cat-count">{{ t('adminCategories.diaryCount', { n: cat.count }) }}</span>
            <div class="actions">
              <button class="btn" @click="startRename(cat)">{{ t('adminCategories.rename') }}</button>
              <button class="btn danger" @click="remove(cat)">{{ t('adminCategories.delete') }}</button>
            </div>
          </template>
        </li>
      </ul>
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
.add-row {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
}
.name-input {
  flex: 1;
  max-width: 320px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  outline: none;
}
.en-input {
  border-color: #d8cbb9 !important;
  background: #fdfaf5;
}
.name-input:focus {
  border-color: var(--color-primary);
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
.cat-list {
  list-style: none;
}
.cat-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border);
}
.cat-item:last-child {
  border-bottom: none;
}
.cat-name {
  font-size: 15px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cat-count {
  font-size: 13px;
  color: var(--color-text-light);
}
.actions {
  margin-left: auto;
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
  margin-right: 0;
}
.btn.primary:hover {
  background: var(--color-primary-dark);
}
.btn.primary:disabled {
  opacity: 0.6;
  cursor: default;
}
.btn.danger:hover {
  border-color: #c0392b;
  color: #c0392b;
}

@media (max-width: 480px) {
  .cat-item {
    flex-wrap: wrap;
    gap: 8px;
  }
  .actions {
    margin-left: 0;
    width: 100%;
  }
  .actions .btn {
    flex: 1;
    text-align: center;
    margin-right: 8px;
  }
}
</style>
