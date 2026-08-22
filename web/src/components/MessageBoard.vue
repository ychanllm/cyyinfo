<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api';

const { t } = useI18n();
const props = defineProps({
  targetType: { type: String, required: true },
  targetId: { type: Number, default: null },
});

const messages = ref([]);
const nickname = ref('');
const content = ref('');
const notice = ref('');
const error = ref('');
const submitting = ref(false);

function fmtDate(s) {
  return String(s || '').slice(0, 10);
}

async function load() {
  try {
    const q = props.targetId ? `&target_id=${props.targetId}` : '';
    messages.value = await api(`/messages?target_type=${props.targetType}${q}`);
  } catch {
    messages.value = [];
  }
}

async function submit() {
  notice.value = '';
  error.value = '';
  if (!nickname.value.trim() || !content.value.trim()) {
    error.value = t('board.required');
    return;
  }
  submitting.value = true;
  try {
    await api('/messages', {
      method: 'POST',
      body: {
        nickname: nickname.value.trim(),
        content: content.value.trim(),
        target_type: props.targetType,
        target_id: props.targetId,
      },
    });
    content.value = '';
    if (props.targetType === 'diary') {
      // 日记评论免审核，发布后立即刷新显示
      notice.value = t('board.published');
      await load();
    } else {
      notice.value = t('board.submitted');
    }
  } catch (e) {
    error.value = e.message;
  } finally {
    submitting.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="board">
    <h2 class="title">{{ t('board.title') }}</h2>
    <form class="form" @submit.prevent="submit">
      <input v-model="nickname" type="text" :placeholder="t('board.nickPlaceholder')" maxlength="20" />
      <textarea
        v-model="content"
        rows="3"
        :placeholder="t('board.contentPlaceholder')"
        maxlength="500"
      ></textarea>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="notice" class="notice">{{ notice }}</p>
      <button type="submit" :disabled="submitting">{{ submitting ? t('board.submitting') : t('board.submit') }}</button>
    </form>
    <ul v-if="messages.length" class="list">
      <li v-for="m in messages" :key="m.id" class="item">
        <div class="meta">
          <span class="nick">{{ m.nickname }}</span>
          <span class="date">{{ fmtDate(m.created_at) }}</span>
        </div>
        <p class="text">{{ m.content }}</p>
      </li>
    </ul>
    <p v-else class="empty">{{ t('board.empty') }}</p>
  </section>
</template>

<style scoped>
.board {
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 24px;
}
.title {
  font-size: 18px;
  color: var(--color-primary);
  margin-bottom: 16px;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
}
input,
textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  outline: none;
  font: inherit;
  resize: vertical;
}
input:focus,
textarea:focus {
  border-color: var(--color-primary);
}
button {
  align-self: flex-end;
  padding: 8px 24px;
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
.error {
  color: #c0392b;
  font-size: 13px;
}
.notice {
  color: #2e7d32;
  font-size: 13px;
}
.list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.item {
  border-top: 1px solid var(--color-border);
  padding-top: 12px;
}
.meta {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  margin-bottom: 4px;
}
.nick {
  color: var(--color-primary);
  font-weight: 600;
}
.date {
  color: var(--color-text-light);
}
.text {
  font-size: 14px;
  white-space: pre-wrap;
  word-break: break-word;
}
.empty {
  color: var(--color-text-light);
  font-size: 14px;
  text-align: center;
}
</style>
