<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, getUserToken } from '../api';
import { localize } from '../i18n';

defineOptions({ name: 'StoresView' });

const { t } = useI18n();
const router = useRouter();
const route = useRoute();

const stores = ref([]);
const loading = ref(true);
const error = ref('');

const loggedIn = computed(() => Boolean(getUserToken()));

// ---- 投稿表单 ----
const formOpen = ref(false);
const formName = ref('');
const formAddress = ref('');
const formNote = ref('');
const formFile = ref(null);
const formDishes = ref([{ name: '', note: '' }]);
const saving = ref(false);
const formError = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    stores.value = await api('/stores');
  } catch (e) {
    error.value = e.message || t('stores.loadFailed');
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function openForm() {
  if (!loggedIn.value) {
    router.push({ path: localize('/login'), query: { redirect: route.fullPath } });
    return;
  }
  formOpen.value = true;
  formName.value = '';
  formAddress.value = '';
  formNote.value = '';
  formFile.value = null;
  formDishes.value = [{ name: '', note: '' }];
  formError.value = '';
}

function addDishRow() {
  if (formDishes.value.length >= 30) return;
  formDishes.value.push({ name: '', note: '' });
}

function removeDishRow(i) {
  formDishes.value.splice(i, 1);
}

function onFileChange(e) {
  formFile.value = e.target.files?.[0] || null;
}

async function submit() {
  if (!formName.value.trim()) {
    formError.value = t('stores.nameRequired');
    return;
  }
  // 菜品至少一个有效菜名，否则去掉空行再校验
  const dishes = formDishes.value
    .map((d) => ({ name: d.name.trim(), note: d.note.trim() }))
    .filter((d) => d.name || d.note);
  if (dishes.some((d) => !d.name)) {
    formError.value = t('stores.dishNameRequired');
    return;
  }
  saving.value = true;
  formError.value = '';
  try {
    const form = new FormData();
    form.append('name', formName.value.trim());
    form.append('address', formAddress.value.trim());
    form.append('note', formNote.value.trim());
    form.append('dishes', JSON.stringify(dishes));
    if (formFile.value) form.append('image', formFile.value);
    await api('/stores', { method: 'POST', form });
    formOpen.value = false;
    await load();
  } catch (e) {
    formError.value = e.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="stores">
    <div class="head">
      <h1 class="page-title">{{ t('stores.title') }}</h1>
      <button class="submit-btn" @click="openForm">
        {{ t('stores.submit') }}
      </button>
    </div>
    <p class="subtitle">{{ t('stores.subtitle') }}</p>

    <p v-if="loading" class="hint">{{ t('stores.loading') }}</p>
    <p v-else-if="error" class="hint">{{ error }}</p>
    <p v-else-if="!stores.length" class="hint">{{ t('stores.empty') }}</p>

    <div v-else class="grid">
      <div
        v-for="(s, i) in stores"
        :key="s.id"
        class="polaroid card"
        :style="{ '--tilt': i % 2 ? '1.3deg' : '-1.4deg' }"
      >
        <span class="tape" :class="i % 3 === 0 ? 'peach' : i % 3 === 1 ? 'stamp' : ''"></span>
        <div class="cover">
          <img v-if="s.image" :src="`/uploads/${s.image}`" :alt="s.name" class="cover-img" />
          <div v-else class="cover-placeholder">
            <span class="placeholder-emoji">🏮</span>
          </div>
        </div>
        <div class="meta">
          <h2 class="title">{{ s.name }}</h2>
          <p v-if="s.address" class="addr">📍 {{ s.address }}</p>
          <p v-if="s.note" class="desc">{{ s.note }}</p>
          <div v-if="s.dishes.length" class="dishes">
            <span v-for="d in s.dishes" :key="d.id" class="dish-chip" :title="d.note || d.name">
              {{ d.name }}<template v-if="d.note"> · {{ d.note }}</template>
            </span>
          </div>
          <p v-else class="no-dishes">{{ t('stores.noDishes') }}</p>
        </div>
      </div>
    </div>

    <div v-if="formOpen" class="modal" @click.self="formOpen = false">
      <form class="form-card" @submit.prevent="submit">
        <h3>{{ t('stores.submitTitle') }}</h3>
        <label class="field">
          {{ t('stores.name') }}
          <input v-model="formName" type="text" maxlength="50" :placeholder="t('stores.namePh')" />
        </label>
        <label class="field">
          {{ t('stores.address') }}
          <input v-model="formAddress" type="text" maxlength="100" :placeholder="t('stores.addressPh')" />
        </label>
        <label class="field">
          {{ t('stores.note') }}
          <textarea v-model="formNote" rows="2" maxlength="300" :placeholder="t('stores.notePh')"></textarea>
        </label>
        <label class="field">
          {{ t('stores.image') }}
          <input type="file" accept="image/*" @change="onFileChange" />
        </label>

        <div class="field">
          <div class="dishes-head">
            <span>{{ t('stores.dishesLabel') }}</span>
            <button type="button" class="add-dish" @click="addDishRow">{{ t('stores.addDish') }}</button>
          </div>
          <div
            v-for="(d, i) in formDishes"
            :key="i"
            class="dish-row"
          >
            <input
              v-model="d.name"
              type="text"
              maxlength="50"
              :placeholder="t('stores.dishNamePh')"
            />
            <input
              v-model="d.note"
              type="text"
              maxlength="100"
              :placeholder="t('stores.dishNotePh')"
            />
            <button
              v-if="formDishes.length > 1"
              type="button"
              class="remove-dish"
              @click="removeDishRow(i)"
            >✕</button>
          </div>
        </div>

        <p v-if="formError" class="form-error">{{ formError }}</p>
        <div class="actions">
          <button type="button" class="btn" @click="formOpen = false">{{ t('stores.cancel') }}</button>
          <button type="submit" class="btn primary" :disabled="saving">
            {{ saving ? t('stores.saving') : t('stores.save') }}
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
}
.page-title {
  font-family: var(--font-title);
  font-size: 28px;
  color: var(--color-text);
}
.subtitle {
  color: var(--color-text-light);
  font-size: 14px;
  margin: 6px 0 28px;
}
.submit-btn {
  border: 1px solid var(--color-primary);
  background: var(--color-primary);
  color: #fff;
  border-radius: 999px;
  padding: 8px 18px;
  font-size: 14px;
  cursor: pointer;
}
.submit-btn:hover {
  background: var(--color-primary-dark);
}
.hint {
  color: var(--color-text-light);
  font-size: 14px;
  text-align: center;
  padding: 32px 0;
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 30px 24px;
  padding-top: 20px; /* 给胶带留出头顶空间 */
}
@media (max-width: 720px) {
  .grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 480px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
.card {
  color: var(--color-text);
}
.cover {
  aspect-ratio: 4 / 3;
  overflow: hidden;
}
.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.cover-placeholder {
  width: 100%;
  height: 100%;
  background: var(--bg-deep);
  display: flex;
  align-items: center;
  justify-content: center;
}
.placeholder-emoji {
  font-size: 48px;
}
.meta {
  padding: 12px 4px 2px;
  text-align: center;
}
.title {
  font-family: var(--font-title);
  font-size: 20px;
  font-weight: 400;
  margin-bottom: 4px;
}
.addr {
  font-size: 13px;
  color: var(--color-text-light);
  margin-bottom: 2px;
}
.desc {
  font-size: 13px;
  color: var(--color-text-light);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.dishes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  margin-top: 8px;
}
.dish-chip {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--bg-deep);
  color: var(--color-text);
  font-size: 12px;
  border: 1px solid var(--color-border);
}
.no-dishes {
  margin-top: 8px;
  font-size: 12px;
  color: var(--color-text-light);
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
  max-width: 460px;
  max-height: 88vh;
  overflow-y: auto;
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
.dishes-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.add-dish {
  border: 1px dashed var(--color-primary);
  background: none;
  color: var(--color-primary);
  border-radius: 999px;
  padding: 3px 12px;
  font-size: 12px;
  cursor: pointer;
}
.dish-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.dish-row input {
  flex: 1;
}
.dish-row input:first-child {
  flex: 2;
}
.remove-dish {
  border: none;
  background: none;
  color: var(--color-text-light);
  font-size: 14px;
  cursor: pointer;
  padding: 0 2px;
}
.form-error {
  color: #c0392b;
  font-size: 13px;
  margin-bottom: 10px;
}
.actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
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
</style>
