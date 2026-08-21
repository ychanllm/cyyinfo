<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../../api';

const { t } = useI18n();
const records = ref([]);
const status = ref(''); // '' | 'pending' | 'used' | 'cancelled'
const loading = ref(true);
const error = ref('');
const acting = ref(false);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const q = status.value ? `?status=${status.value}` : '';
    records.value = await api(`/admin/prize-records${q}`, { admin: true });
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function markUsed(r) {
  acting.value = true;
  error.value = '';
  try {
    await api(`/admin/prize-records/${r.id}/use`, { method: 'POST', admin: true });
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    acting.value = false;
  }
}

async function cancel(r) {
  if (!confirm(t('adminPrizeRecords.confirmCancel', { name: r.prize_name, user: r.username, cost: r.points_spent }))) return;
  acting.value = true;
  error.value = '';
  try {
    await api(`/admin/prize-records/${r.id}/cancel`, { method: 'POST', admin: true });
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    acting.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="records-view">
    <div class="head">
      <h2 class="page-title">{{ t('adminPrizeRecords.title') }}</h2>
      <select v-model="status" class="filter" @change="load">
        <option value="">{{ t('adminPrizeRecords.all') }}</option>
        <option value="pending">{{ t('adminPrizeRecords.pending') }}</option>
        <option value="used">{{ t('adminPrizeRecords.used') }}</option>
        <option value="cancelled">{{ t('adminPrizeRecords.cancelled') }}</option>
      </select>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <section class="card">
      <p v-if="loading" class="hint">{{ t('adminPrizeRecords.loading') }}</p>
      <p v-else-if="!records.length" class="hint">{{ t('adminPrizeRecords.empty') }}</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>{{ t('adminPrizeRecords.colUser') }}</th>
            <th>{{ t('adminPrizeRecords.colPrize') }}</th>
            <th>{{ t('adminPrizeRecords.colSource') }}</th>
            <th>{{ t('adminPrizeRecords.colCost') }}</th>
            <th>{{ t('adminPrizeRecords.colStatus') }}</th>
            <th>{{ t('adminPrizeRecords.colTime') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in records" :key="r.id">
            <td>{{ r.username }}</td>
            <td>{{ r.prize_name }}</td>
            <td>{{ r.source === 'box' ? t('adminPrizeRecords.fromBox') : t('adminPrizeRecords.fromRedeem') }}</td>
            <td>{{ r.points_spent }}</td>
            <td>
              <span class="badge" :class="r.status">
                {{ t(`adminPrizeRecords.${r.status}`) }}
              </span>
            </td>
            <td>{{ r.created_at }}</td>
            <td class="actions">
              <template v-if="r.status === 'pending'">
                <button class="btn" :disabled="acting" @click="markUsed(r)">{{ t('adminPrizeRecords.markUsed') }}</button>
                <button class="btn danger" :disabled="acting" @click="cancel(r)">{{ t('adminPrizeRecords.cancel') }}</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
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
.filter {
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: 14px;
  background: #fff;
}
.error {
  color: #c0392b;
  font-size: 14px;
  margin-bottom: 16px;
}
.hint {
  color: var(--color-text-light);
  font-size: 14px;
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
.badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  background: var(--bg-deep);
  color: var(--color-text-light);
}
.badge.pending {
  background: #fdf3e0;
  color: #b9770e;
}
.badge.used {
  background: #e6f6ec;
  color: #1e8e4f;
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
.btn.danger:hover {
  border-color: #c0392b;
  color: #c0392b;
}
.btn:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
