<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../../api';

const { t } = useI18n();
const users = ref([]);
const loading = ref(true);
const error = ref('');

// 新增账号表单
const newUsername = ref('');
const newPassword = ref('');
const newDisplayName = ref('');
const creating = ref(false);

async function loadUsers() {
  loading.value = true;
  error.value = '';
  try {
    users.value = await api('/admin/users', { admin: true });
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function createUser() {
  if (!newUsername.value.trim() || !newPassword.value) {
    error.value = t('adminUsers.required');
    return;
  }
  creating.value = true;
  error.value = '';
  try {
    await api('/admin/users', {
      method: 'POST',
      admin: true,
      body: {
        username: newUsername.value.trim(),
        password: newPassword.value,
        display_name: newDisplayName.value.trim() || newUsername.value.trim(),
      },
    });
    newUsername.value = '';
    newPassword.value = '';
    newDisplayName.value = '';
    await loadUsers();
  } catch (e) {
    error.value = e.message;
  } finally {
    creating.value = false;
  }
}

async function saveUser(user) {
  error.value = '';
  try {
    const body = { display_name: user.display_name.trim() };
    if (user._newPassword) body.password = user._newPassword;
    await api(`/admin/users/${user.id}`, { method: 'PUT', admin: true, body });
    user._newPassword = '';
    await loadUsers();
  } catch (e) {
    error.value = e.message;
  }
}

async function removeUser(user) {
  if (!confirm(t('adminUsers.confirmDelete', { username: user.username }))) return;
  error.value = '';
  try {
    await api(`/admin/users/${user.id}`, { method: 'DELETE', admin: true });
    await loadUsers();
  } catch (e) {
    error.value = e.message;
  }
}

function fmtTime(s) {
  if (!s) return '—';
  const d = new Date(s.endsWith('Z') || s.includes('+') ? s : `${s.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return s;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

onMounted(loadUsers);
</script>

<template>
  <div class="users-view">
    <h2 class="page-title">{{ t('adminUsers.title') }}</h2>
    <p v-if="error" class="error">{{ error }}</p>

    <section class="card">
      <h3>{{ t('adminUsers.new') }}</h3>
      <form class="create-form" @submit.prevent="createUser">
        <input v-model="newUsername" type="text" :placeholder="t('adminUsers.username')" />
        <input v-model="newPassword" type="password" :placeholder="t('adminUsers.password')" />
        <input v-model="newDisplayName" type="text" :placeholder="t('adminUsers.nickOptional')" />
        <button type="submit" :disabled="creating">{{ creating ? t('adminUsers.creating') : t('adminUsers.create') }}</button>
      </form>
    </section>

    <section class="card">
      <h3>{{ t('adminUsers.list') }}</h3>
      <p v-if="loading" class="hint">{{ t('adminUsers.loading') }}</p>
      <table v-else class="user-table">
        <thead>
          <tr>
            <th class="col-username">{{ t('adminUsers.username') }}</th>
            <th>{{ t('adminUsers.nick') }}</th>
            <th>{{ t('adminUsers.resetPassword') }}</th>
            <th class="col-time">{{ t('adminUsers.createdAt') }}</th>
            <th class="col-actions">{{ t('adminUsers.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.id">
            <td class="col-username">{{ user.username }}</td>
            <td><input v-model="user.display_name" type="text" /></td>
            <td><input v-model="user._newPassword" type="password" :placeholder="t('adminUsers.passwordPh')" /></td>
            <td class="col-time">{{ fmtTime(user.created_at) }}</td>
            <td class="col-actions">
              <button class="btn" @click="saveUser(user)">{{ t('adminUsers.save') }}</button>
              <button class="btn danger" @click="removeUser(user)">{{ t('adminUsers.delete') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.page-title {
  font-size: 22px;
  margin-bottom: 20px;
}
.error {
  color: #c0392b;
  font-size: 14px;
  margin-bottom: 16px;
}
.card {
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 20px 24px;
  margin-bottom: 24px;
}
.card h3 {
  font-size: 16px;
  margin-bottom: 14px;
}
.create-form {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.create-form input {
  flex: 1;
  min-width: 140px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  outline: none;
}
.create-form input:focus {
  border-color: var(--color-primary);
}
.create-form button {
  border: none;
  border-radius: 8px;
  padding: 10px 20px;
  background: var(--color-primary);
  color: #fff;
  cursor: pointer;
}
.create-form button:disabled {
  opacity: 0.6;
  cursor: default;
}
.hint {
  color: var(--color-text-light);
  font-size: 14px;
}
.user-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.user-table th {
  text-align: left;
  color: var(--color-text-light);
  font-weight: normal;
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border);
}
.user-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border);
}
.user-table input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  outline: none;
}
.user-table input:focus {
  border-color: var(--color-primary);
  background: #fff;
}
.col-username {
  width: 120px;
}
.col-time {
  width: 110px;
  color: var(--color-text-light);
  white-space: nowrap;
}
.col-actions {
  width: 150px;
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
.btn.danger:hover {
  border-color: #c0392b;
  color: #c0392b;
}
</style>
