<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../../api';

const siteName = ref('');
const anniversaryDate = ref('');
const passcodeEnabled = ref(false);
const newPasscode = ref('');
const backgroundColor = ref('#f9e1ef');
const heroLabel = ref('');
const heroTitle = ref('');
const smtpHost = ref('smtp.qq.com');
const smtpPort = ref('465');
const smtpUser = ref('');
const smtpPass = ref('');
const defaultRecipient = ref('');

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
    anniversaryDate.value = data.anniversary_date || '';
    passcodeEnabled.value = data.passcode_enabled;
    backgroundColor.value = data.background_color || '#f9e1ef';
    heroLabel.value = data.hero_label || '';
    heroTitle.value = data.hero_title || '';
    smtpHost.value = data.smtp_host || 'smtp.qq.com';
    smtpPort.value = data.smtp_port || '465';
    smtpUser.value = data.smtp_user || '';
    smtpPass.value = data.smtp_pass || '';
    defaultRecipient.value = data.default_recipient || '';
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
        anniversary_date: anniversaryDate.value,
        background_color: backgroundColor.value.trim() || '',
        hero_label: heroLabel.value.trim(),
        hero_title: heroTitle.value.trim(),
      },
    });
    success.value = '已保存';
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
    success.value = '邮件设置已保存';
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

async function savePasscode() {
  if (!newPasscode.value) {
    error.value = '请输入新口令';
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
    success.value = '口令已更新';
    await loadSettings();
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

async function clearPasscode() {
  if (!confirm('确定清除访客口令吗？清除后网站将对所有人公开。')) return;
  saving.value = true;
  error.value = '';
  success.value = '';
  try {
    await api('/admin/settings', {
      method: 'PUT',
      admin: true,
      body: { passcode: '' },
    });
    success.value = '口令已清除';
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
    <h2 class="page-title">站点设置</h2>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="success" class="success">{{ success }}</p>
    <p v-if="loading" class="hint">加载中…</p>

    <template v-else>
      <section class="card">
        <h3>基本设置</h3>
        <form class="form" @submit.prevent="saveBasic">
          <label class="field">
            站点名称
            <input v-model="siteName" type="text" placeholder="站点名称" />
          </label>
          <label class="field">
            纪念日起始日期
            <input v-model="anniversaryDate" type="date" />
          </label>
          <label class="field">
            背景颜色（默认 #f9e1ef）
            <input v-model="backgroundColor" type="color" class="color-input" />
            <input v-model="backgroundColor" type="text" placeholder="#f9e1ef" />
          </label>
          <label class="field">
            首页标签（{date} 会替换成纪念日，留空自动生成）
            <input v-model="heroLabel" type="text" placeholder="如：从 {date} 到现在" />
          </label>
          <label class="field">
            首页标题（{days} 会替换成天数，留空自动生成）
            <input v-model="heroTitle" type="text" placeholder="如：我们在一起 {days} 天" />
          </label>
          <button type="submit" class="submit-btn" :disabled="saving">
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </form>
      </section>

      <section class="card">
        <h3>访客口令</h3>
        <p class="status">
          当前状态：
          <span class="badge" :class="passcodeEnabled ? 'enabled' : 'disabled'">
            {{ passcodeEnabled ? '已启用' : '未启用' }}
          </span>
        </p>
        <form class="form" @submit.prevent="savePasscode">
          <label class="field">
            新口令
            <input
              v-model="newPasscode"
              type="password"
              placeholder="输入后保存即为设置/修改口令"
              autocomplete="new-password"
            />
          </label>
          <div class="actions">
            <button type="submit" class="submit-btn" :disabled="saving">保存口令</button>
            <button
              v-if="passcodeEnabled"
              type="button"
              class="btn danger"
              :disabled="saving"
              @click="clearPasscode"
            >
              清除口令
            </button>
          </div>
        </form>
      </section>

      <section class="card">
        <h3>邮件设置（提醒事项用）</h3>
        <p class="status">用于「提醒事项」到点自动发邮件。发件用 QQ 邮箱 SMTP：QQ邮箱 → 设置 → 账户 → 开启 SMTP 服务后获取授权码（不是登录密码）。</p>
        <form class="form" @submit.prevent="saveSmtp">
          <label class="field">
            SMTP 服务器
            <input v-model="smtpHost" type="text" placeholder="smtp.qq.com" />
          </label>
          <label class="field">
            SMTP 端口
            <input v-model="smtpPort" type="text" placeholder="465" />
          </label>
          <label class="field">
            发件 QQ 邮箱
            <input v-model="smtpUser" type="email" placeholder="xxx@qq.com" />
          </label>
          <label class="field">
            SMTP 授权码
            <input v-model="smtpPass" type="password" placeholder="16 位授权码" autocomplete="new-password" />
          </label>
          <label class="field">
            默认收件邮箱（提醒默认发到这里）
            <input v-model="defaultRecipient" type="email" placeholder="xxx@qq.com" />
          </label>
          <button type="submit" class="submit-btn" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button>
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
.field input {
  display: block;
  width: 100%;
  margin-top: 4px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: 14px;
  outline: none;
}
.field input:focus {
  border-color: var(--color-primary);
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
