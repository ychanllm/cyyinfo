<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, setGuestToken, getAdminToken } from '../api';
import { localize } from '../i18n';

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const passcode = ref('');
const error = ref('');
const loading = ref(false);

// 已登录管理员不应停在访客门禁页（防御：手动输入 /gate 时自动回后台）
onMounted(() => {
  if (getAdminToken()) router.replace(localize('/admin'));
});

// 验证后回到原本要访问的页面，默认回首页
const redirectTarget = computed(() => {
  const r = route.query.redirect;
  return typeof r === 'string' && r.startsWith('/') ? r : localize('/');
});

async function submit() {
  error.value = '';
  if (!passcode.value.trim()) {
    error.value = t('gate.enterPasscode');
    return;
  }
  loading.value = true;
  try {
    const { token } = await api('/passcode/verify', {
      method: 'POST',
      body: { passcode: passcode.value.trim() },
    });
    setGuestToken(token);
    router.replace(redirectTarget.value);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="gate">
    <form class="card" @submit.prevent="submit">
      <h1>{{ t('gate.title') }}</h1>
      <p class="hint">{{ t('gate.hint') }}</p>
      <input
        v-model="passcode"
        type="password"
        :placeholder="t('gate.passcodePlaceholder')"
        autocomplete="off"
      />
      <p v-if="error" class="error">{{ error }}</p>
      <button type="submit" :disabled="loading">{{ loading ? t('gate.verifying') : t('gate.submit') }}</button>
    </form>
    <router-link :to="localize('/admin/login')" class="admin-link">{{ t('gate.adminLink') }}</router-link>
  </div>
</template>

<style scoped>
.gate {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-deep);
  padding: 24px;
}
.card {
  width: 100%;
  max-width: 360px;
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 40px 32px;
  text-align: center;
}
h1 {
  font-size: 24px;
  color: var(--color-primary);
  margin-bottom: 8px;
}
.hint {
  font-size: 14px;
  color: var(--color-text-light);
  margin-bottom: 24px;
}
input {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  margin-bottom: 12px;
  outline: none;
}
input:focus {
  border-color: var(--color-primary);
}
.error {
  color: #c0392b;
  font-size: 13px;
  margin-bottom: 12px;
}
button {
  width: 100%;
  padding: 12px;
  border: none;
  border-radius: 8px;
  background: var(--color-primary);
  color: #fff;
  cursor: pointer;
}
button:hover:not(:disabled) {
  background: var(--color-primary-dark);
}
button:disabled {
  opacity: 0.6;
  cursor: default;
}
.admin-link {
  display: block;
  margin-top: 20px;
  font-size: 13px;
  color: var(--color-text-light);
  text-align: center;
}
</style>
