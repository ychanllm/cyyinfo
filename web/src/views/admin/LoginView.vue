<script setup>
import { ref, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, setAdminToken } from '../../api';
import { localize } from '../../i18n';

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const username = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);

// 登录后回到原本要访问的页面（如 /admin/diaries），默认进后台
const redirectTarget = computed(() => {
  const r = route.query.redirect;
  return typeof r === 'string' && r.startsWith('/') ? r : localize('/admin');
});

async function submit() {
  error.value = '';
  if (!username.value.trim() || !password.value) {
    error.value = t('adminLogin.required');
    return;
  }
  loading.value = true;
  try {
    const { token } = await api('/admin/login', {
      method: 'POST',
      body: { username: username.value.trim(), password: password.value },
    });
    setAdminToken(token);
    router.replace(redirectTarget.value);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login">
    <form class="card" @submit.prevent="submit">
      <h1>{{ t('adminLogin.title') }}</h1>
      <p class="hint">{{ t('adminLogin.hint') }}</p>
      <input v-model="username" type="text" :placeholder="t('adminLogin.username')" autocomplete="username" />
      <input v-model="password" type="password" :placeholder="t('adminLogin.password')" autocomplete="current-password" />
      <p v-if="error" class="error">{{ error }}</p>
      <button type="submit" :disabled="loading">{{ loading ? t('adminLogin.signingIn') : t('adminLogin.signIn') }}</button>
    </form>
  </div>
</template>

<style scoped>
.login {
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
</style>
