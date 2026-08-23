<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../../api';

const { t } = useI18n();
const siteName = ref('');
const siteNameEn = ref('');
const anniversaryDate = ref('');
const passcodeEnabled = ref(false);
const newPasscode = ref('');
const backgroundColor = ref('#f9e1ef');
const heroLabel = ref('');
const heroLabelEn = ref('');
const heroTitle = ref('');
const heroTitleEn = ref('');
const smtpHost = ref('smtp.qq.com');
const smtpPort = ref('465');
const smtpUser = ref('');
const smtpPass = ref('');
const defaultRecipient = ref('');
const checkinBase = ref('10');
const checkinBonus = ref('5');
const checkinMax = ref('40');
const boxCost = ref('100');
// 点赞归属用户：管理员在前台点赞时记到该注册用户头上
const siteUsers = ref([]);
const adminLikeUserId = ref('');

const loading = ref(true);
const saving = ref(false);
const error = ref('');
const success = ref('');

async function loadSettings() {
  loading.value = true;
  error.value = '';
  try {
    const data = await api('/admin/settings', { admin: true });
    siteName.value = data.site_name || '';
    siteNameEn.value = data.site_name_en || '';
    anniversaryDate.value = data.anniversary_date || '';
    passcodeEnabled.value = data.passcode_enabled;
    backgroundColor.value = data.background_color || '#f9e1ef';
    heroLabel.value = data.hero_label || '';
    heroLabelEn.value = data.hero_label_en || '';
    heroTitle.value = data.hero_title || '';
    heroTitleEn.value = data.hero_title_en || '';
    smtpHost.value = data.smtp_host || 'smtp.qq.com';
    smtpPort.value = data.smtp_port || '465';
    smtpUser.value = data.smtp_user || '';
    smtpPass.value = data.smtp_pass || '';
    defaultRecipient.value = data.default_recipient || '';
    adminLikeUserId.value = data.admin_like_user_id || '';
    siteUsers.value = await api('/admin/site-users', { admin: true });
    const ck = await api('/admin/checkin-settings', { admin: true });
    checkinBase.value = ck.checkin_base_points;
    checkinBonus.value = ck.checkin_streak_bonus;
    checkinMax.value = ck.checkin_max_points;
    boxCost.value = ck.box_cost;
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function saveBasic() {
  saving.value = true;
  error.value = '';
  success.value = '';
  try {
    await api('/admin/settings', {
      method: 'PUT',
      admin: true,
      body: {
        site_name: siteName.value.trim(),
        site_name_en: siteNameEn.value.trim(),
        anniversary_date: anniversaryDate.value,
        background_color: backgroundColor.value.trim() || '',
        hero_label: heroLabel.value.trim(),
        hero_label_en: heroLabelEn.value.trim(),
        hero_title: heroTitle.value.trim(),
        hero_title_en: heroTitleEn.value.trim(),
      },
    });
    success.value = t('adminSettings.saved');
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

async function saveSmtp() {
  saving.value = true;
  error.value = '';
  success.value = '';
  try {
    await api('/admin/settings', {
      method: 'PUT',
      admin: true,
      body: {
        smtp_host: smtpHost.value.trim(),
        smtp_port: smtpPort.value.trim() || '587',
        smtp_user: smtpUser.value.trim(),
        smtp_pass: smtpPass.value.trim(),
        default_recipient: defaultRecipient.value.trim(),
      },
    });
    success.value = t('adminSettings.smtpSaved');
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

async function savePasscode() {
  if (!newPasscode.value) {
    error.value = t('adminSettings.passcodeRequired');
    return;
  }
  saving.value = true;
  error.value = '';
  success.value = '';
  try {
    await api('/admin/settings', {
      method: 'PUT',
      admin: true,
      body: { passcode: newPasscode.value },
    });
    newPasscode.value = '';
    success.value = t('adminSettings.passcodeUpdated');
    await loadSettings();
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

async function saveLike() {
  saving.value = true;
  error.value = '';
  success.value = '';
  try {
    await api('/admin/settings', {
      method: 'PUT',
      admin: true,
      body: { admin_like_user_id: adminLikeUserId.value },
    });
    success.value = t('adminSettings.likeSaved');
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

async function saveCheckin() {
  saving.value = true;
  error.value = '';
  success.value = '';
  try {
    await api('/admin/checkin-settings', {
      method: 'PUT',
      admin: true,
      body: {
        checkin_base_points: Number(checkinBase.value),
        checkin_streak_bonus: Number(checkinBonus.value),
        checkin_max_points: Number(checkinMax.value),
        box_cost: Number(boxCost.value),
      },
    });
    success.value = t('adminSettings.checkinSaved');
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

async function clearPasscode() {
  if (!confirm(t('adminSettings.confirmClearPasscode'))) return;
  saving.value = true;
  error.value = '';
  success.value = '';
  try {
    await api('/admin/settings', {
      method: 'PUT',
      admin: true,
      body: { passcode: '' },
    });
    success.value = t('adminSettings.passcodeCleared');
    await loadSettings();
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

onMounted(loadSettings);
</script>

<template>
  <div class="settings-view">
    <h2 class="page-title">{{ t('adminSettings.title') }}</h2>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="success" class="success">{{ success }}</p>
    <p v-if="loading" class="hint">{{ t('adminSettings.loading') }}</p>

    <template v-else>
      <section class="card">
        <h3>{{ t('adminSettings.basic') }}</h3>
        <form class="form" @submit.prevent="saveBasic">
          <label class="field">
            {{ t('adminSettings.siteNameZh') }}
            <input v-model="siteName" type="text" :placeholder="t('adminSettings.siteName')" />
          </label>
          <label class="field">
            {{ t('adminSettings.siteNameEn') }}
            <input v-model="siteNameEn" type="text" class="en-input" :placeholder="t('adminSettings.siteNameEnPh')" />
          </label>
          <label class="field">
            {{ t('adminSettings.anniversary') }}
            <input v-model="anniversaryDate" type="date" />
          </label>
          <label class="field">
            {{ t('adminSettings.bgColor') }}
            <input v-model="backgroundColor" type="color" class="color-input" />
            <input v-model="backgroundColor" type="text" placeholder="#f9e1ef" />
          </label>
          <label class="field">
            {{ t('adminSettings.heroLabelZh') }}
            <input v-model="heroLabel" type="text" :placeholder="t('adminSettings.heroLabelPh')" />
          </label>
          <label class="field">
            {{ t('adminSettings.heroLabelEn') }}
            <input v-model="heroLabelEn" type="text" class="en-input" :placeholder="t('adminSettings.heroLabelEnPh')" />
          </label>
          <label class="field">
            {{ t('adminSettings.heroTitleZh') }}
            <input v-model="heroTitle" type="text" :placeholder="t('adminSettings.heroTitlePh')" />
          </label>
          <label class="field">
            {{ t('adminSettings.heroTitleEn') }}
            <input v-model="heroTitleEn" type="text" class="en-input" :placeholder="t('adminSettings.heroTitleEnPh')" />
          </label>
          <button type="submit" class="submit-btn" :disabled="saving">
            {{ saving ? t('adminSettings.saving') : t('adminSettings.save') }}
          </button>
        </form>
      </section>

      <section class="card">
        <h3>{{ t('adminSettings.passcode') }}</h3>
        <p class="status">
          {{ t('adminSettings.currentStatus') }}
          <span class="badge" :class="passcodeEnabled ? 'enabled' : 'disabled'">
            {{ passcodeEnabled ? t('adminSettings.enabled') : t('adminSettings.disabled') }}
          </span>
        </p>
        <form class="form" @submit.prevent="savePasscode">
          <label class="field">
            {{ t('adminSettings.newPasscode') }}
            <input
              v-model="newPasscode"
              type="password"
              :placeholder="t('adminSettings.newPasscodePh')"
              autocomplete="new-password"
            />
          </label>
          <div class="actions">
            <button type="submit" class="submit-btn" :disabled="saving">{{ t('adminSettings.savePasscode') }}</button>
            <button
              v-if="passcodeEnabled"
              type="button"
              class="btn danger"
              :disabled="saving"
              @click="clearPasscode"
            >
              {{ t('adminSettings.clearPasscode') }}
            </button>
          </div>
        </form>
      </section>

      <section class="card">
        <h3>{{ t('adminSettings.smtp') }}</h3>
        <p class="status">{{ t('adminSettings.smtpHint') }}</p>
        <form class="form" @submit.prevent="saveSmtp">
          <label class="field">
            {{ t('adminSettings.smtpHost') }}
            <input v-model="smtpHost" type="text" placeholder="smtp.qq.com" />
          </label>
          <label class="field">
            {{ t('adminSettings.smtpPort') }}
            <input v-model="smtpPort" type="text" placeholder="465" />
          </label>
          <label class="field">
            {{ t('adminSettings.smtpUser') }}
            <input v-model="smtpUser" type="email" placeholder="xxx@qq.com" />
          </label>
          <label class="field">
            {{ t('adminSettings.smtpPass') }}
            <input v-model="smtpPass" type="password" :placeholder="t('adminSettings.smtpPassPh')" autocomplete="new-password" />
          </label>
          <label class="field">
            {{ t('adminSettings.defaultRecipient') }}
            <input v-model="defaultRecipient" type="email" placeholder="xxx@qq.com" />
          </label>
          <button type="submit" class="submit-btn" :disabled="saving">{{ saving ? t('adminSettings.saving') : t('adminSettings.save') }}</button>
        </form>
      </section>

      <section class="card">
        <h3>{{ t('adminSettings.like') }}</h3>
        <p class="status">{{ t('adminSettings.likeAttributionHint') }}</p>
        <form class="form" @submit.prevent="saveLike">
          <label class="field">
            {{ t('adminSettings.likeAttribution') }}
            <select v-model="adminLikeUserId">
              <option value="">{{ t('adminSettings.likeNone') }}</option>
              <option v-for="u in siteUsers" :key="u.id" :value="String(u.id)">{{ u.username }}</option>
            </select>
          </label>
          <button type="submit" class="submit-btn" :disabled="saving">
            {{ saving ? t('adminSettings.saving') : t('adminSettings.save') }}
          </button>
        </form>
      </section>

      <section class="card">
        <h3>{{ t('adminSettings.checkin') }}</h3>
        <form class="form" @submit.prevent="saveCheckin">
          <label class="field">
            {{ t('adminSettings.checkinBase') }}
            <input v-model="checkinBase" type="number" min="1" />
          </label>
          <label class="field">
            {{ t('adminSettings.checkinBonus') }}
            <input v-model="checkinBonus" type="number" min="1" />
          </label>
          <label class="field">
            {{ t('adminSettings.checkinMax') }}
            <input v-model="checkinMax" type="number" min="1" />
          </label>
          <label class="field">
            {{ t('adminSettings.boxCost') }}
            <input v-model="boxCost" type="number" min="1" />
          </label>
          <button type="submit" class="submit-btn" :disabled="saving">
            {{ saving ? t('adminSettings.saving') : t('adminSettings.save') }}
          </button>
        </form>
      </section>
    </template>
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
.success {
  color: #1e8e4f;
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
  margin-bottom: 24px;
  max-width: 480px;
}
.card h3 {
  font-size: 16px;
  margin-bottom: 14px;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.field {
  display: block;
  font-size: 13px;
  color: var(--color-text-light);
}
.field input,
.field select {
  display: block;
  width: 100%;
  margin-top: 4px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  background: #fff;
}
.field input:focus,
.field select:focus {
  border-color: var(--color-primary);
}
.en-input {
  border-color: #d8cbb9 !important;
  background: #fdfaf5;
}
.field .color-input {
  width: 64px;
  height: 40px;
  padding: 2px;
  cursor: pointer;
}
.submit-btn {
  border: none;
  border-radius: 8px;
  padding: 10px 20px;
  background: var(--color-primary);
  color: #fff;
  cursor: pointer;
  align-self: flex-start;
}
.submit-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.status {
  font-size: 14px;
  margin-bottom: 14px;
}
.badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
}
.badge.enabled {
  background: #e6f6ec;
  color: #1e8e4f;
}
.badge.disabled {
  background: var(--bg-deep);
  color: var(--color-text-light);
}
.actions {
  display: flex;
  gap: 8px;
}
.btn {
  border: 1px solid var(--color-border);
  background: #fff;
  border-radius: 8px;
  padding: 10px 20px;
  font-size: 14px;
  color: var(--color-text);
  cursor: pointer;
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
