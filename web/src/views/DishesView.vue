<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, getUserToken } from '../api';
import { localize } from '../i18n';

defineOptions({ name: 'DishesView' });

const { t } = useI18n();
const router = useRouter();
const route = useRoute();

const dishes = ref([]);
const loading = ref(true);
const error = ref('');

const loggedIn = computed(() => Boolean(getUserToken()));

// ---- 投稿表单 ----
const formOpen = ref(false);
const formName = ref('');
const formDesc = ref('');
const formFile = ref(null);
const saving = ref(false);
const formError = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    dishes.value = await api('/dishes');
  } catch (e) {
    error.value = e.message || t('dishes.loadFailed');
  } finally {
    loading.value = false;
  }
}

onMounted(load);

// 想吃 toggle：未登录引导去登录页（沿用项目 redirect 惯例）
async function toggleWant(d) {
  if (!loggedIn.value) {
    router.push({ path: localize('/login'), query: { redirect: route.fullPath } });
    return;
  }
  if (d._busy) return;
  d._busy = true;
  try {
    const data = await api(`/dishes/${d.id}/want`, { method: 'POST' });
    d.wanted_by_me = data.wanted;
    d.want_count = data.want_count;
  } catch { /* 错误已由 api.js 统一处理 */ } finally {
    d._busy = false;
  }
}

function onFileChange(e) {
  formFile.value = e.target.files?.[0] || null;
}

async function submit() {
  if (!formName.value.trim()) {
    formError.value = t('dishes.nameRequired');
    return;
  }
  saving.value = true;
  formError.value = '';
  try {
    const form = new FormData();
    form.append('name', formName.value.trim());
    form.append('description', formDesc.value.trim());
    if (formFile.value) form.append('image', formFile.value);
    await api('/dishes', { method: 'POST', form });
    formOpen.value = false;
    formName.value = '';
    formDesc.value = '';
    formFile.value = null;
    await load();
  } catch (e) {
    formError.value = e.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="dishes">
    <div class="head">
      <h1 class="page-title">{{ t('dishes.title') }}</h1>
      <button v-if="loggedIn" class="submit-btn" @click="formOpen = true">
        {{ t('dishes.submit') }}
      </button>
    </div>
    <p class="subtitle">{{ t('dishes.subtitle') }}</p>

    <p v-if="loading" class="hint">{{ t('dishes.loading') }}</p>
    <p v-else-if="error" class="hint">{{ error }}</p>
    <p v-else-if="!dishes.length" class="hint">{{ t('dishes.empty') }}</p>

    <div v-else class="grid">
      <div
        v-for="(d, i) in dishes"
        :key="d.id"
        class="polaroid card"
        :style="{ '--tilt': i % 2 ? '1.3deg' : '-1.4deg' }"
      >
        <span class="tape" :class="i % 3 === 0 ? 'peach' : i % 3 === 1 ? 'stamp' : ''"></span>
        <div class="cover">
          <img v-if="d.image" :src="`/uploads/${d.image}`" :alt="d.name" class="cover-img" />
          <div v-else class="cover-placeholder">
            <span class="placeholder-emoji">🍲</span>
          </div>
        </div>
        <div class="meta">
          <h2 class="title">{{ d.name }}</h2>
          <p v-if="d.description" class="desc">{{ d.description }}</p>
          <button
            type="button"
            class="want-btn"
            :class="{ wanted: d.wanted_by_me }"
            :disabled="d._busy"
            :title="loggedIn ? t('dishes.wantTip') : t('dishes.loginToWant')"
            @click="toggleWant(d)"
          >
            <span class="heart">{{ d.wanted_by_me ? '❤️' : '🤍' }}</span>
            {{ t('dishes.want') }} {{ d.want_count }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="formOpen" class="modal" @click.self="formOpen = false">
      <form class="form-card" @submit.prevent="submit">
        <h3>{{ t('dishes.submitTitle') }}</h3>
        <label class="field">
          {{ t('dishes.name') }}
          <input v-model="formName" type="text" maxlength="50" :placeholder="t('dishes.namePh')" />
        </label>
        <label class="field">
          {{ t('dishes.desc') }}
          <textarea v-model="formDesc" rows="3" maxlength="200" :placeholder="t('dishes.descPh')"></textarea>
        </label>
        <label class="field">
          {{ t('dishes.image') }}
          <input type="file" accept="image/*" @change="onFileChange" />
        </label>
        <p v-if="formError" class="form-error">{{ formError }}</p>
        <div class="actions">
          <button type="button" class="btn" @click="formOpen = false">{{ t('dishes.cancel') }}</button>
          <button type="submit" class="btn primary" :disabled="saving">
            {{ saving ? t('dishes.saving') : t('dishes.save') }}
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
.desc {
  font-size: 13px;
  color: var(--color-text-light);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.want-btn {
  margin-top: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 14px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-card);
  color: var(--color-text-light);
  font-size: 13px;
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
}
.want-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.want-btn.wanted {
  border-color: var(--color-primary);
  color: var(--color-stamp);
}
.want-btn:disabled {
  cursor: default;
  opacity: 0.7;
}
.heart {
  font-size: 14px;
  line-height: 1;
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
