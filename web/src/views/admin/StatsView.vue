<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../../api';

const { t } = useI18n();
const data = ref(null);
const loading = ref(true);
const error = ref('');

const CARDS = ['users', 'likes', 'views', 'messages', 'photos', 'albums', 'diaries'];

function fmtTime(s) {
  return s ? String(s).slice(0, 10) : '—';
}

onMounted(async () => {
  try {
    data.value = await api('/admin/stats', { admin: true });
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="stats-page">
    <h2 class="page-title">{{ t('adminStats.title') }}</h2>
    <p v-if="loading" class="hint">{{ t('adminStats.loading') }}</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <template v-else-if="data">
      <div class="cards">
        <div v-for="key in CARDS" :key="key" class="stat-card">
          <span class="num">{{ data.overview[key] }}</span>
          <span class="cap">{{ t(`adminStats.${key}`) }}</span>
        </div>
      </div>

      <section class="card">
        <span class="label">{{ t('adminStats.userTable') }}</span>
        <p v-if="!data.users.length" class="hint">{{ t('adminStats.empty') }}</p>
        <table v-else class="table">
          <thead>
            <tr>
              <th>{{ t('adminStats.colUser') }}</th>
              <th>{{ t('adminStats.colCreated') }}</th>
              <th>{{ t('adminStats.colCheckins') }}</th>
              <th>{{ t('adminStats.colPoints') }}</th>
              <th>{{ t('adminStats.colLikes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in data.users" :key="u.id">
              <td class="user-cell">
                <img v-if="u.avatar" :src="`/uploads/${u.avatar}`" class="avatar" alt="" />
                <span v-else class="avatar avatar-placeholder">{{ u.username.slice(0, 1).toUpperCase() }}</span>
                {{ u.username }}
              </td>
              <td>{{ fmtTime(u.created_at) }}</td>
              <td>{{ u.checkins }}</td>
              <td>{{ u.points }}</td>
              <td>{{ u.likes }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<style scoped>
.page-title {
  font-size: 22px;
  margin-bottom: 20px;
}
.hint {
  color: var(--color-text-light);
  font-size: 13px;
}
.error {
  color: #c0392b;
  font-size: 14px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}
.stat-card {
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.num {
  font-size: 26px;
  font-weight: 600;
  color: var(--color-primary);
}
.cap {
  font-size: 13px;
  color: var(--color-text-light);
}
.card {
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 20px 24px;
}
.label {
  display: block;
  font-size: 13px;
  color: var(--color-text-light);
  margin-bottom: 10px;
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.table th,
.table td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border);
}
.table th {
  font-size: 13px;
  color: var(--color-text-light);
  font-weight: 400;
}
.user-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
}
.avatar-placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-deep);
  color: var(--color-text-light);
  font-size: 13px;
}
</style>
