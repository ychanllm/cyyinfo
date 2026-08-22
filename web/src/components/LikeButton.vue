<script setup>
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, getUserToken } from '../api';
import { localize } from '../i18n';

const { t } = useI18n();
const router = useRouter();
const route = useRoute();

const props = defineProps({
  targetType: { type: String, required: true }, // 'album' | 'photo' | 'diary'
  targetId: { type: Number, required: true },
  count: { type: Number, default: 0 },
  liked: { type: Boolean, default: false },
});
const emit = defineEmits(['update']); // ({ liked, count })

const busy = ref(false);
const pop = ref(false); // 点赞成功的小弹跳动画

async function toggle() {
  if (busy.value) return;
  // 未登录：去登录页，登录后回跳当前页（沿用项目 redirect 惯例）
  if (!getUserToken()) {
    router.push({ path: localize('/login'), query: { redirect: route.fullPath } });
    return;
  }
  busy.value = true;
  try {
    const data = await api('/likes/toggle', {
      method: 'POST',
      body: { target_type: props.targetType, target_id: props.targetId },
    });
    emit('update', data);
    if (data.liked) {
      pop.value = true;
      setTimeout(() => { pop.value = false; }, 400);
    }
  } catch { /* 错误已由 api.js 统一处理 */ } finally {
    busy.value = false;
  }
}
</script>

<template>
  <button
    type="button"
    class="like-btn"
    :class="{ liked, pop }"
    :disabled="busy"
    :title="getUserToken() ? (liked ? t('likes.liked') : t('likes.like')) : t('likes.loginToLike')"
    @click.stop.prevent="toggle"
  >
    <span class="heart">{{ liked ? '♥' : '♡' }}</span>
    <span v-if="count" class="n">{{ count }}</span>
  </button>
</template>

<style scoped>
.like-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-card);
  color: var(--color-text-light);
  font-size: 13px;
  line-height: 1.4;
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
}
.like-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.like-btn.liked {
  border-color: var(--color-primary);
  color: var(--color-stamp);
}
.heart {
  font-size: 15px;
  line-height: 1;
}
.like-btn.pop .heart {
  animation: like-pop 0.4s ease;
}
@keyframes like-pop {
  0% { transform: scale(1); }
  40% { transform: scale(1.45); }
  70% { transform: scale(0.9); }
  100% { transform: scale(1); }
}
.like-btn:disabled {
  cursor: default;
}
</style>
