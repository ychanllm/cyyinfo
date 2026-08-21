<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, apiUpload } from '../../api';

const { t } = useI18n();
const prizes = ref([]);
const loading = ref(true);
const error = ref('');

// 弹窗编辑（新增/编辑共用）
const showForm = ref(false);
const editing = ref(null); // null=新增，否则为奖品对象
const form = ref({});
const saving = ref(false);
const uploading = ref(false);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    prizes.value = await api('/admin/prizes', { admin: true });
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editing.value = null;
  form.value = {
    name: '', name_en: '', description: '', description_en: '',
    points_cost: 0, box_weight: 0, stock: -1, sort_order: 0, is_active: 1, image: '',
  };
  showForm.value = true;
}

function openEdit(p) {
  editing.value = p;
  form.value = { ...p };
  showForm.value = true;
}

async function save() {
  if (!form.value.name?.trim()) {
    error.value = t('adminPrizes.nameRequired');
    return;
  }
  saving.value = true;
  error.value = '';
  const body = {
    name: form.value.name.trim(),
    name_en: (form.value.name_en || '').trim(),
    description: (form.value.description || '').trim(),
    description_en: (form.value.description_en || '').trim(),
    points_cost: Number(form.value.points_cost),
    box_weight: Number(form.value.box_weight),
    stock: Number(form.value.stock),
    sort_order: Number(form.value.sort_order),
  };
  try {
    if (editing.value) {
      await api(`/admin/prizes/${editing.value.id}`, { method: 'PUT', admin: true, body: { ...body, is_active: Number(form.value.is_active) } });
    } else {
      await api('/admin/prizes', { method: 'POST', admin: true, body });
    }
    showForm.value = false;
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

async function uploadImage(e) {
  const file = e.target.files?.[0];
  if (!file || !editing.value) return;
  uploading.value = true;
  error.value = '';
  try {
    const fd = new FormData();
    fd.append('file', file);
    const { image } = await apiUpload(`/admin/prizes/${editing.value.id}/image`, fd);
    form.value.image = image;
    await load();
  } catch (err) {
    error.value = err.message;
  } finally {
    uploading.value = false;
    e.target.value = '';
  }
}

async function remove(p) {
  if (!confirm(t('adminPrizes.confirmDelete', { name: p.name }))) return;
  error.value = '';
  try {
    await api(`/admin/prizes/${p.id}`, { method: 'DELETE', admin: true });
    await load();
  } catch (e) {
    error.value = e.message;
  }
}

onMounted(load);
</script>

<template>
  <div class="prizes-view">
    <div class="head">
      <h2 class="page-title">{{ t('adminPrizes.title') }}</h2>
      <button class="btn primary" @click="openCreate">{{ t('adminPrizes.add') }}</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <section class="card">
      <p v-if="loading" class="hint">{{ t('adminPrizes.loading') }}</p>
      <p v-else-if="!prizes.length" class="hint">{{ t('adminPrizes.empty') }}</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>{{ t('adminPrizes.colName') }}</th>
            <th>{{ t('adminPrizes.colCost') }}</th>
            <th>{{ t('adminPrizes.colWeight') }}</th>
            <th>{{ t('adminPrizes.colStock') }}</th>
            <th>{{ t('adminPrizes.colStatus') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in prizes" :key="p.id">
            <td>
              <img v-if="p.image" :src="`/uploads/${p.image}`" class="thumb" :alt="p.name" />
              {{ p.name }}
            </td>
            <td>{{ p.points_cost || '—' }}</td>
            <td>{{ p.box_weight || '—' }}</td>
            <td>{{ p.stock === -1 ? t('adminPrizes.unlimited') : p.stock }}</td>
            <td>
              <span class="badge" :class="p.is_active ? 'enabled' : 'disabled'">
                {{ p.is_active ? t('adminPrizes.active') : t('adminPrizes.inactive') }}
              </span>
            </td>
            <td class="actions">
              <button class="btn" @click="openEdit(p)">{{ t('adminPrizes.edit') }}</button>
              <button class="btn danger" @click="remove(p)">{{ t('adminPrizes.delete') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <div v-if="showForm" class="modal-mask" @click.self="showForm = false">
      <div class="modal">
        <h3>{{ editing ? t('adminPrizes.edit') : t('adminPrizes.add') }}</h3>
        <form class="form" @submit.prevent="save">
          <label class="field">{{ t('adminPrizes.nameZh') }}
            <input v-model="form.name" type="text" />
          </label>
          <label class="field">{{ t('adminPrizes.nameEn') }}
            <input v-model="form.name_en" type="text" class="en-input" />
          </label>
          <label class="field">{{ t('adminPrizes.descZh') }}
            <input v-model="form.description" type="text" />
          </label>
          <label class="field">{{ t('adminPrizes.descEn') }}
            <input v-model="form.description_en" type="text" class="en-input" />
          </label>
          <label class="field">{{ t('adminPrizes.cost') }}
            <input v-model.number="form.points_cost" type="number" min="0" />
          </label>
          <label class="field">{{ t('adminPrizes.weight') }}
            <input v-model.number="form.box_weight" type="number" min="0" />
          </label>
          <label class="field">{{ t('adminPrizes.stock') }}
            <input v-model.number="form.stock" type="number" min="-1" />
          </label>
          <label class="field">{{ t('adminPrizes.sort') }}
            <input v-model.number="form.sort_order" type="number" min="0" />
          </label>
          <label v-if="editing" class="field checkbox">
            <input v-model="form.is_active" type="checkbox" :true-value="1" :false-value="0" />
            {{ t('adminPrizes.active') }}
          </label>
          <label v-if="editing" class="field">{{ t('adminPrizes.image') }}
            <input type="file" accept="image/*" :disabled="uploading" @change="uploadImage" />
            <img v-if="form.image" :src="`/uploads/${form.image}`" class="thumb" alt="" />
          </label>
          <p v-if="!editing" class="hint">{{ t('adminPrizes.imageAfterCreate') }}</p>
          <div class="form-actions">
            <button type="submit" class="btn primary" :disabled="saving">
              {{ saving ? t('adminPrizes.saving') : t('adminPrizes.save') }}
            </button>
            <button type="button" class="btn" @click="showForm = false">{{ t('adminPrizes.cancel') }}</button>
          </div>
        </form>
      </div>
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
  font-size: 13px;
}
.card {
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 20px 24px;
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.table th,
.table td {
  text-align: left;
  padding: 10px 8px;
  border-bottom: 1px solid var(--color-border);
}
.table th {
  color: var(--color-text-light);
  font-weight: 500;
  font-size: 13px;
}
.thumb {
  width: 36px;
  height: 36px;
  object-fit: cover;
  border-radius: 6px;
  vertical-align: middle;
  margin-right: 8px;
}
.badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
}
.badge.enabled {
  background: #e6f6ec;
  color: #1e8e4f;
}
.badge.disabled {
  background: var(--bg-deep);
  color: var(--color-text-light);
}
.actions {
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
.btn.primary:disabled {
  opacity: 0.6;
  cursor: default;
}
.btn.danger:hover {
  border-color: #c0392b;
  color: #c0392b;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 24px;
}
.modal {
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 24px 28px;
  width: 100%;
  max-width: 440px;
  max-height: 85vh;
  overflow-y: auto;
}
.modal h3 {
  margin: 0 0 14px;
  font-size: 17px;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.field {
  display: block;
  font-size: 13px;
  color: var(--color-text-light);
}
.field input:not([type='checkbox']) {
  display: block;
  width: 100%;
  margin-top: 4px;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: 14px;
  outline: none;
}
.field input:focus {
  border-color: var(--color-primary);
}
.field.checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
}
.en-input {
  border-color: #d8cbb9 !important;
  background: #fdfaf5;
}
.form-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
</style>
