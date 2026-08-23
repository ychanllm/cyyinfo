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
});
const emit = defineEmits(['update']); // ({ liked, count })

const MAX_TAPS = 50;       // 与后端 MAX_PER_USER 一致（前端按本次会话点按次数钳制）
const FLUSH_MS = 300;      // 连点聚合发送间隔
const LONG_PRESS_MS = 500; // 长按判定

const busy = ref(false);   // 仅长按取消时用
const pop = ref(false);    // 点赞成功的小弹跳动画
const maxTip = ref(false); // 达上限提示

// 飘心粒子
const hearts = ref([]); // [{ id, x, drift, rot }]
let heartSeq = 0;

// 连击聚合
const taps = ref(0);        // 本次会话已点次数（用于上限提示）
const pendingDelta = ref(0);
let flushTimer = null;
let flushing = false;

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
    emit('update', data); // 服务端权威计数（含他人点赞与上限钳制）
  } catch {
    // 失败回滚乐观增量
    emit('update', { liked: props.liked, count: Math.max(0, props.count - delta) });
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
  if (taps.value >= MAX_TAPS) {
    maxTip.value = true;
    setTimeout(() => { maxTip.value = false; }, 1500);
    return;
  }
  taps.value += 1;
  pendingDelta.value += 1;
  spawnHeart(x);
  pop.value = true;
  setTimeout(() => { pop.value = false; }, 400);
  emit('update', { liked: true, count: props.count + 1 }); // 乐观更新
  scheduleFlush();
}

// 点按 / 长按区分：pointerdown 起 500ms 内松开 = 点按(+1)；超过 = 长按(取消全部)
let pressTimer = null;
let longPressed = false;

function onPointerDown() {
  longPressed = false;
  pressTimer = setTimeout(() => {
    longPressed = true;
    cancelAll();
  }, LONG_PRESS_MS);
}
function onPointerUp(e) {
  clearTimeout(pressTimer);
  pressTimer = null;
  if (!longPressed) tap(e.offsetX ?? 14);
}
function onPointerCancel() {
  clearTimeout(pressTimer);
  pressTimer = null;
}

async function cancelAll() {
  if (busy.value || !canLike() || !props.liked) return;
  busy.value = true;
  pendingDelta.value = 0; // 丢弃未发送的连点
  try {
    const data = await api('/likes/toggle', {
      method: 'POST',
      body: { target_type: props.targetType, target_id: props.targetId },
    });
    taps.value = 0;
    emit('update', data);
  } catch { /* 错误已由 api.js 统一处理 */ } finally {
    busy.value = false;
  }
}

onUnmounted(() => {
  clearTimeout(pressTimer);
  clearTimeout(flushTimer);
});
</script>

<template>
  <button
    type="button"
    class="like-btn"
    :class="{ liked, pop }"
    :disabled="busy"
    :title="canLike() ? (liked ? t('likes.unlikeAll') : t('likes.like')) : t('likes.loginToLike')"
    @pointerdown.stop.prevent="onPointerDown"
    @pointerup.stop.prevent="onPointerUp"
    @pointerleave="onPointerCancel"
    @pointercancel="onPointerCancel"
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
.like-btn:disabled {
  cursor: default;
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
