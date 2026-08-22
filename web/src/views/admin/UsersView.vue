<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../../api';

const { t, locale } = useI18n();
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

function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s.endsWith('Z') || s.includes('+') ? s : `${s.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return s;
  const pad = (n) => String(n).padStart(2, '0');
  return `${fmtTime(s)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---- 注册用户（前台注册的 users 表账号）----
const siteUsers = ref([]);
const siteUsersLoading = ref(true);
const expandedId = ref(0);
const detail = ref({ loading: false, checkins: [], transactions: [] });

async function loadSiteUsers() {
  siteUsersLoading.value = true;
  try {
    siteUsers.value = await api('/admin/site-users', { admin: true });
  } catch (e) {
    error.value = e.message;
  } finally {
    siteUsersLoading.value = false;
  }
}

async function saveSiteUserPassword(u) {
  if (!u._newPassword || u._newPassword.length < 6) {
    error.value = t('adminUsers.passwordTooShort');
    return;
  }
  error.value = '';
  try {
    await api(`/admin/site-users/${u.id}`, {
      method: 'PUT',
      admin: true,
      body: { password: u._newPassword },
    });
    u._newPassword = '';
  } catch (e) {
    error.value = e.message;
  }
}

async function toggleDetail(u) {
  if (expandedId.value === u.id) {
    expandedId.value = 0;
    return;
  }
  expandedId.value = u.id;
  detail.value = { loading: true, checkins: [], transactions: [] };
  error.value = '';
  try {
    const [checkins, transactions] = await Promise.all([
      api(`/admin/site-users/${u.id}/checkins`, { admin: true }),
      api(`/admin/site-users/${u.id}/point-transactions`, { admin: true }),
    ]);
    detail.value = { loading: false, checkins, transactions };
  } catch (e) {
    error.value = e.message;
    expandedId.value = 0;
  }
}

const TX_TYPE_KEYS = {
  checkin: 'typeCheckin',
  box: 'typeBox',
  redeem: 'typeRedeem',
  cancel_refund: 'typeCancelRefund',
};

function txReason(tx) {
  const base = t(`adminUsers.${TX_TYPE_KEYS[tx.type] ?? 'typeOther'}`);
  if (tx.type === 'checkin') return base;
  const prize = locale.value === 'en' ? (tx.prize_name_en || tx.prize_name) : tx.prize_name;
  return prize ? `${base}：${prize}` : base;
}

onMounted(() => {
  loadUsers();
  loadSiteUsers();
});
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
    <section class="card">
      <h3>{{ t('adminUsers.siteUsers') }}</h3>
      <p v-if="siteUsersLoading" class="hint">{{ t('adminUsers.loading') }}</p>
      <p v-else-if="!siteUsers.length" class="hint">{{ t('adminUsers.emptyUsers') }}</p>
      <table v-else class="user-table">
        <thead>
          <tr>
            <th class="col-avatar">{{ t('adminUsers.avatar') }}</th>
            <th class="col-username">{{ t('adminUsers.username') }}</th>
            <th class="col-points">{{ t('adminUsers.pointsCol') }}</th>
            <th>{{ t('adminUsers.resetPassword') }}</th>
            <th class="col-time">{{ t('adminUsers.createdAt') }}</th>
            <th class="col-actions">{{ t('adminUsers.actions') }}</th>
          </tr>
        </thead>
        <tbody v-for="u in siteUsers" :key="u.id">
          <tr>
            <td class="col-avatar">
              <img v-if="u.avatar" :src="`/uploads/${u.avatar}`" class="avatar-img" :alt="u.username" />
              <span v-else class="avatar-img placeholder">{{ u.username.charAt(0).toUpperCase() }}</span>
            </td>
            <td class="col-username">{{ u.username }}</td>
            <td class="col-points">{{ u.points }}</td>
            <td><input v-model="u._newPassword" type="password" :placeholder="t('adminUsers.passwordPh')" /></td>
            <td class="col-time">{{ fmtTime(u.created_at) }}</td>
            <td class="col-actions">
              <button class="btn" @click="saveSiteUserPassword(u)">{{ t('adminUsers.save') }}</button>
              <button class="btn" @click="toggleDetail(u)">
                {{ expandedId === u.id ? t('adminUsers.collapse') : t('adminUsers.detail') }}
              </button>
            </td>
          </tr>
          <tr v-if="expandedId === u.id" class="detail-row">
            <td colspan="6">
              <p v-if="detail.loading" class="hint">{{ t('adminUsers.loading') }}</p>
              <template v-else>
                <h4>{{ t('adminUsers.checkinsTitle') }}</h4>
                <p v-if="!detail.checkins.length" class="hint">{{ t('adminUsers.emptyCheckins') }}</p>
                <table v-else class="detail-table">
                  <thead>
                    <tr>
                      <th>{{ t('adminUsers.colCheckinDate') }}</th>
                      <th>{{ t('adminUsers.colStreak') }}</th>
                      <th>{{ t('adminUsers.colEarned') }}</th>
                      <th>{{ t('adminUsers.colTime') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="ci in detail.checkins" :key="ci.id">
                      <td>{{ ci.checkin_date }}</td>
                      <td>{{ ci.streak_day }}</td>
                      <td class="pos">+{{ ci.points_earned }}</td>
                      <td>{{ fmtDateTime(ci.created_at) }}</td>
                    </tr>
                  </tbody>
                </table>
                <h4>{{ t('adminUsers.txTitle') }}</h4>
                <p v-if="!detail.transactions.length" class="hint">{{ t('adminUsers.emptyTx') }}</p>
                <table v-else class="detail-table">
                  <thead>
                    <tr>
                      <th>{{ t('adminUsers.colTime') }}</th>
                      <th>{{ t('adminUsers.colChange') }}</th>
                      <th>{{ t('adminUsers.colBalance') }}</th>
                      <th>{{ t('adminUsers.colReason') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="tx in detail.transactions" :key="tx.id">
                      <td>{{ fmtDateTime(tx.created_at) }}</td>
                      <td :class="tx.change >= 0 ? 'pos' : 'neg'">{{ tx.change > 0 ? '+' : '' }}{{ tx.change }}</td>
                      <td>{{ tx.balance_after }}</td>
                      <td>{{ txReason(tx) }}</td>
                    </tr>
                  </tbody>
                </table>
              </template>
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
.col-points {
  width: 70px;
}
.col-avatar {
  width: 50px;
}
.avatar-img {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
}
.avatar-img.placeholder {
  background: var(--bg-deep);
  color: var(--color-text-light);
}
.detail-row td {
  background: rgba(0, 0, 0, 0.02);
  padding: 14px 12px;
}
.detail-row h4 {
  font-size: 14px;
  margin: 4px 0 8px;
}
.detail-row h4 + .detail-table {
  margin-bottom: 16px;
}
.detail-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.detail-table th {
  text-align: left;
  color: var(--color-text-light);
  font-weight: normal;
  padding: 4px 8px;
  border-bottom: 1px solid var(--color-border);
}
.detail-table td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--color-border);
}
.pos {
  color: #27ae60;
}
.neg {
  color: #c0392b;
}
</style>
