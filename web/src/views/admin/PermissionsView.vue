<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../../api';

const { t } = useI18n();
const users = ref([]);
const loading = ref(true);
const saving = ref(0); // 正在保存的用户 id，0 = 无

async function load() {
  loading.value = true;
  try {
    users.value = await api('/admin/permissions', { admin: true });
  } finally {
    loading.value = false;
  }
}

async function toggle(u, key) {
  u[key] = u[key] ? 0 : 1; // 乐观切换，失败回滚
  saving.value = u.id;
  try {
    await api(`/admin/permissions/${u.id}`, {
      method: 'PUT', admin: true,
      body: { diary: Boolean(u.diary), album: Boolean(u.album) },
    });
  } catch {
    u[key] = u[key] ? 0 : 1;
    alert(t('adminPerms.saveFailed'));
  } finally {
    saving.value = 0;
  }
}

onMounted(load);
</script>

<template>
  <div class="perms">
    <h2>{{ t('adminPerms.title') }}</h2>
    <p class="desc">{{ t('adminPerms.desc') }}</p>
    <p v-if="loading">{{ t('adminDishes.loading') }}</p>
    <p v-else-if="!users.length" class="empty">{{ t('adminPerms.empty') }}</p>
    <table v-else class="table">
      <thead>
        <tr>
          <th>{{ t('adminPerms.user') }}</th>
          <th>{{ t('adminPerms.diary') }}</th>
          <th>{{ t('adminPerms.album') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="u in users" :key="u.id">
          <td>{{ u.username }}</td>
          <td>
            <input
              type="checkbox"
              :checked="Boolean(u.diary)"
              :disabled="saving === u.id"
              @change="toggle(u, 'diary')"
            />
          </td>
          <td>
            <input
              type="checkbox"
              :checked="Boolean(u.album)"
              :disabled="saving === u.id"
              @change="toggle(u, 'album')"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.perms h2 {
  margin: 0 0 8px;
  color: var(--color-primary-dark);
}
.desc {
  color: var(--color-text-light);
  font-size: 14px;
  margin: 0 0 20px;
}
.empty {
  color: var(--color-text-light);
}
.table {
  width: 100%;
  border-collapse: collapse;
  background: var(--color-card);
  border-radius: 8px;
  overflow: hidden;
}
.table th,
.table td {
  text-align: left;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border);
  font-size: 14px;
}
.table th {
  color: var(--color-text-light);
  font-weight: 500;
}
.table input[type='checkbox'] {
  width: 18px;
  height: 18px;
  accent-color: var(--color-primary);
  cursor: pointer;
}
</style>
