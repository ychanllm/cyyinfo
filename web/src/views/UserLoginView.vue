<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, setUserToken, getGuestToken, getAdminToken } from '../api';
import { loadSiteStatus } from '../site-status';
import { loadMe } from '../me';
import { localize } from '../i18n';
import { autoPlayMusic } from '../player';

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const mode = ref('login'); // 'login' | 'register'
const username = ref('');
const password = ref('');
const confirmPassword = ref('');
const error = ref('');
const loading = ref(false);
// 站点启用了口令且未通过口令：注册会被后端拒绝，先提示去过口令
const needPasscode = ref(false);

onMounted(async () => {
  try {
    const s = await loadSiteStatus();
    needPasscode.value = s.passcode_enabled && !getGuestToken() && !getAdminToken();
  } catch { /* 状态拉取失败不阻塞登录 */ }
});

const redirectTarget = computed(() => {
  const r = route.query.redirect;
  return typeof r === 'string' && r.startsWith('/') ? r : localize('/points');
});

async function submit() {
  error.value = '';
  const name = username.value.trim();
  if (!name || !password.value) {
    error.value = t('userAuth.fillAll');
    return;
  }
  if (mode.value === 'register') {
    if (password.value.length < 6) {
      error.value = t('userAuth.passwordTooShort');
      return;
    }
    if (password.value !== confirmPassword.value) {
      error.value = t('userAuth.passwordMismatch');
      return;
    }
  }
  loading.value = true;
  try {
    const path = mode.value === 'login' ? '/auth/login' : '/auth/register';
    const data = await api(path, { method: 'POST', body: { username: name, password: password.value } });
    setUserToken(data.token);
    // 新登录视为新会话：重置无头像提示的关闭标记，保证登录后重新提醒
    sessionStorage.removeItem('avatar_prompt_dismissed');
    await loadMe();
    router.replace(redirectTarget.value);
    autoPlayMusic();
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="user-login">
    <form class="card" @submit.prevent="submit">
      <h1>{{ t('userAuth.title') }}</h1>
      <div class="tabs">
        <button
          type="button"
          :class="['tab', { active: mode === 'login' }]"
          @click="mode = 'login'; error = ''"
        >{{ t('userAuth.loginTab') }}</button>
        <button
          type="button"
          :class="['tab', { active: mode === 'register' }]"
          @click="mode = 'register'; error = ''"
        >{{ t('userAuth.registerTab') }}</button>
      </div>
      <p v-if="needPasscode && mode === 'register'" class="hint">
        {{ t('userAuth.needPasscode') }}
        <router-link :to="{ path: localize('/gate'), query: { redirect: localize('/login') } }">
          {{ t('userAuth.goGate') }}
        </router-link>
      </p>
      <input v-model="username" type="text" :placeholder="t('userAuth.usernamePh')" autocomplete="username" />
      <input
        v-model="password"
        type="password"
        :placeholder="t('userAuth.passwordPh')"
        :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
      />
      <input
        v-if="mode === 'register'"
        v-model="confirmPassword"
        type="password"
        :placeholder="t('userAuth.confirmPasswordPh')"
        autocomplete="new-password"
      />
      <p v-if="error" class="error">{{ error }}</p>
      <button type="submit" :disabled="loading">
        {{ loading ? t('userAuth.submitting') : (mode === 'login' ? t('userAuth.loginTab') : t('userAuth.registerTab')) }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.user-login {
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
  margin-bottom: 20px;
}
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}
.tab {
  flex: 1;
  padding: 8px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: none;
  color: var(--color-text-light);
  cursor: pointer;
  font-size: 14px;
}
.tab.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
.hint {
  font-size: 13px;
  color: var(--color-text-light);
  margin-bottom: 12px;
}
.hint a {
  color: var(--color-primary);
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
button[type='submit'] {
  width: 100%;
  padding: 12px;
  border: none;
  border-radius: 8px;
  background: var(--color-primary);
  color: #fff;
  cursor: pointer;
}
button[type='submit']:hover:not(:disabled) {
  background: var(--color-primary-dark);
}
button[type='submit']:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
