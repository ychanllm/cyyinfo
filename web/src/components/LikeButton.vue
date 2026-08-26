<script setup>
import { ref, onUnmounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, getUserToken, getAdminToken } from '../api';
import { localize } from '../i18n';

const { t } = useI18n();
const router = useRouter();
const route = useRoute();

const props = defineProps({
  targetType: { type: String, required: true }, // 'album' | 'photo' | 'diary' | 'message'
  targetId: { type: Number, required: true },
  count: { type: Number, default: 0 },
  liked: { type: Boolean, default: false },
  dailyRemaining: { type: Number, default: null }, // 服务端下发的当日剩余次数；null = 未知
});
const emit = defineEmits(['update']); // ({ liked, count, daily_remaining? })

const MAX_PER_DAY = 50;  // 与后端 MAX_PER_DAY 一致（仅作未知时的缺省）
const FLUSH_MS = 300;    // 连点聚合发送间隔

const pop = ref(false);    // 点赞成功的小弹跳动画
const maxTip = ref(false); // 达上限提示

// 飘心粒子
const hearts = ref([]); // [{ id, x, drift, rot }]
let heartSeq = 0;

// 连击聚合
const remaining = ref(null); // 当日剩余（flush 后以服务端为准；null = 用 prop/缺省）
const pendingDelta = ref(0);
let flushTimer = null;
let flushing = false;

const left = () => remaining.value ?? props.dailyRemaining ?? MAX_PER_DAY;

function showMaxTip() {
  maxTip.value = true;
  setTimeout(() => { maxTip.value = false; }, 1500);
}

function spawnHeart(x) {
  const id = ++heartSeq;
  hearts.value.push({
    id,
    x, // 相对按钮的点击横坐标 px
    drift: (Math.random() * 2 - 1) * 24,          // 上飘时随机左右偏移
    rot: (Math.random() * 2 - 1) * 30,            // 随机旋转
  });
  setTimeout(() => {
    hearts.value = hearts.value.filter((h) => h.id !== id);
  }, 800);
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_MS);
}

async function flush() {
  if (flushing) { scheduleFlush(); return; }
  const delta = pendingDelta.value;
  if (!delta) return;
  pendingDelta.value = 0;
  flushing = true;
  try {
    const data = await api('/likes/burst', {
      method: 'POST',
      body: { target_type: props.targetType, target_id: props.targetId, delta },
    });
    if (typeof data.daily_remaining === 'number') remaining.value = data.daily_remaining;
    emit('update', data); // 服务端权威计数（含他人点赞与每日上限钳制）
  } catch {
    // 失败回滚乐观增量与本地剩余
    if (remaining.value !== null) remaining.value += delta;
    emit('update', { liked: props.liked, count: Math.max(0, props.count - delta), daily_remaining: left() });
  } finally {
    flushing = false;
    if (pendingDelta.value) scheduleFlush();
  }
}

// 注册用户或管理员均可点赞（管理员点赞记到后台设置的归属用户）
const canLike = () => Boolean(getUserToken() || getAdminToken());

function tap(x) {
  // 未登录：去登录页，登录后回跳当前页（沿用项目 redirect 惯例）
  if (!canLike()) {
    router.push({ path: localize('/login'), query: { redirect: route.fullPath } });
    return;
  }
  if (left() <= 0) {
    showMaxTip();
    return;
  }
  if (remaining.value !== null) remaining.value -= 1;
  pendingDelta.value += 1;
  spawnHeart(x);
  pop.value = true;
  setTimeout(() => { pop.value = false; }, 400);
  emit('update', { liked: true, count: props.count + 1, daily_remaining: left() }); // 乐观更新
  scheduleFlush();
}

onUnmounted(() => {
  clearTimeout(flushTimer);
});
</script>

<template>
  <button
    type="button"
    class="like-btn"
    :class="{ liked, pop }"
    :title="canLike() ? t('likes.like') : t('likes.loginToLike')"
    @click.stop.prevent="tap($event.offsetX ?? 14)"
    @contextmenu.prevent
  >
    <span class="heart">{{ liked ? '♥' : '♡' }}</span>
    <span v-if="count" class="n">{{ count }}</span>
    <span
      v-for="h in hearts"
      :key="h.id"
      class="fly-heart"
      :style="{ left: `${h.x}px`, '--drift': `${h.drift}px`, '--rot': `${h.rot}deg` }"
    >♥</span>
    <span v-if="maxTip" class="max-tip">{{ t('likes.max') }}</span>
  </button>
</template>

<style scoped>
.like-btn {
  position: relative;
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
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation; /* 禁双击缩放，保证连击手感 */
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
.fly-heart {
  position: absolute;
  bottom: 100%;
  margin-left: -8px;
  color: var(--color-stamp);
  font-size: 16px;
  pointer-events: none;
  animation: heart-fly 0.8s ease-out forwards;
}
@keyframes heart-fly {
  0% { opacity: 1; transform: translate(0, 0) scale(0.6) rotate(0deg); }
  60% { opacity: 1; }
  100% { opacity: 0; transform: translate(var(--drift), -56px) scale(1.2) rotate(var(--rot)); }
}
.max-tip {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  background: rgba(30, 24, 18, 0.85);
  color: #f3ece2;
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 6px;
  pointer-events: none;
}
</style>
