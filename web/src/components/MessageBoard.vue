<script setup>
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import LikeButton from './LikeButton.vue';

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
// 评论点赞状态：id -> { count, liked }
const likeStates = ref({});
// 内联回复表单：当前展开的评论 id
const replyFor = ref(null);
const replyNick = ref('');
const replyContent = ref('');
const replyError = ref('');
const replySubmitting = ref(false);

// 顶级评论 + 各自的楼中楼回复（回复的回复已被后端挂到顶级）
const topMessages = computed(() => messages.value.filter((m) => !m.parent_id));
const repliesOf = (id) =>
  messages.value.filter((m) => m.parent_id === id).sort((a, b) => a.id - b.id);

function fmtDate(s) {
  return String(s || '').slice(0, 10);
}

function likeState(id) {
  return likeStates.value[id] || { count: 0, liked: false };
}

async function loadLikes() {
  if (!messages.value.length) {
    likeStates.value = {};
    return;
  }
  try {
    const ids = messages.value.map((m) => m.id).join(',');
    likeStates.value = await api(`/likes/batch?target_type=message&ids=${ids}`);
  } catch { /* 点赞计数加载失败不阻塞留言展示 */ }
}

async function load() {
  try {
    const q = props.targetId ? `&target_id=${props.targetId}` : '';
    messages.value = await api(`/messages?target_type=${props.targetType}${q}`);
    await loadLikes();
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

function openReply(m) {
  replyFor.value = m.id;
  replyNick.value = nickname.value;
  replyContent.value = '';
  replyError.value = '';
}

async function submitReply(m) {
  replyError.value = '';
  if (!replyNick.value.trim() || !replyContent.value.trim()) {
    replyError.value = t('board.required');
    return;
  }
  replySubmitting.value = true;
  try {
    await api('/messages', {
      method: 'POST',
      body: {
        nickname: replyNick.value.trim(),
        content: replyContent.value.trim(),
        target_type: props.targetType,
        target_id: props.targetId,
        parent_id: m.id,
      },
    });
    replyFor.value = null;
    if (props.targetType === 'diary') {
      notice.value = t('board.published');
      await load();
    } else {
      notice.value = t('board.submitted');
    }
  } catch (e) {
    replyError.value = e.message;
  } finally {
    replySubmitting.value = false;
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
    <ul v-if="topMessages.length" class="list">
      <li v-for="m in topMessages" :key="m.id" class="item">
        <div class="meta">
          <span class="nick">{{ m.nickname }}</span>
          <span class="date">{{ fmtDate(m.created_at) }}</span>
        </div>
        <p class="text">{{ m.content }}</p>
        <div class="actions">
          <LikeButton
            target-type="message"
            :target-id="m.id"
            :count="likeState(m.id).count"
            :liked="likeState(m.id).liked"
            @update="likeStates[m.id] = $event"
          />
          <button type="button" class="reply-btn" @click="replyFor === m.id ? (replyFor = null) : openReply(m)">
            {{ t('board.reply') }}
          </button>
        </div>
        <form v-if="replyFor === m.id" class="form reply-form" @submit.prevent="submitReply(m)">
          <input v-model="replyNick" type="text" :placeholder="t('board.nickPlaceholder')" maxlength="20" />
          <textarea
            v-model="replyContent"
            rows="2"
            :placeholder="t('board.contentPlaceholder')"
            maxlength="500"
          ></textarea>
          <p v-if="replyError" class="error">{{ replyError }}</p>
          <button type="submit" :disabled="replySubmitting">
            {{ replySubmitting ? t('board.submitting') : t('board.submit') }}
          </button>
        </form>
        <ul v-if="repliesOf(m.id).length" class="reply-list">
          <li v-for="r in repliesOf(m.id)" :key="r.id" class="item reply-item">
            <div class="meta">
              <span class="nick">{{ r.nickname }}</span>
              <span class="date">{{ fmtDate(r.created_at) }}</span>
            </div>
            <p class="text">{{ r.content }}</p>
            <div class="actions">
              <LikeButton
                target-type="message"
                :target-id="r.id"
                :count="likeState(r.id).count"
                :liked="likeState(r.id).liked"
                @update="likeStates[r.id] = $event"
              />
              <button type="button" class="reply-btn" @click="replyFor === m.id ? (replyFor = null) : openReply(m)">
                {{ t('board.reply') }}
              </button>
            </div>
          </li>
        </ul>
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
.reply-form {
  margin: 10px 0 0;
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
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.reply-btn {
  align-self: auto;
  padding: 3px 10px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-card);
  color: var(--color-text-light);
  font-size: 13px;
  line-height: 1.4;
}
.reply-btn:hover:not(:disabled) {
  background: var(--color-card);
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.reply-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
  margin-left: 16px;
  padding-left: 12px;
  border-left: 2px solid var(--color-border);
}
.reply-item {
  border-top: none;
  padding-top: 0;
}
.empty {
  color: var(--color-text-light);
  font-size: 14px;
  text-align: center;
}
</style>
