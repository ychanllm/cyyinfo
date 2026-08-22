<script setup>
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { i18n } from '../i18n';
import { state as playerState } from '../player';

const wrap = ref(null);
const bubble = ref(null);
const cv = ref(null);

const pos = reactive({ x: 0, y: 0 });
let pet = null;
let dragState = null;
let suppressClick = false;
let unmounted = false;
// 移动端（coarse）只点不拖
const canDrag = window.matchMedia('(pointer: fine)').matches;
const isMobile = window.matchMedia('(max-width: 768px)').matches;
// MiniPlayer 固定底栏（移动端高约 57px）+ 间隙，移动端需为桌宠预留
const PLAYER_CLEARANCE = 72;

function bottomMargin() {
  return isMobile && playerState.queue.length ? 24 + PLAYER_CLEARANCE : 24;
}

function onPointerDown(e) {
  if (!canDrag || e.button !== 0) return;
  dragState = {
    id: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    baseX: pos.x,
    baseY: pos.y,
    moved: false,
  };
  wrap.value.setPointerCapture(e.pointerId);
}

function onPointerMove(e) {
  if (!dragState || e.pointerId !== dragState.id) return;
  const dx = e.clientX - dragState.startX;
  const dy = e.clientY - dragState.startY;
  if (Math.abs(dx) + Math.abs(dy) > 5) dragState.moved = true; // 位移 < 5px 视为点击
  if (dragState.moved) {
    const rect = wrap.value.getBoundingClientRect();
    pos.x = Math.min(Math.max(dragState.baseX + dx, 0), window.innerWidth - rect.width);
    pos.y = Math.min(Math.max(dragState.baseY + dy, 0), window.innerHeight - rect.height);
  }
}

function onPointerUp(e) {
  if (!dragState || e.pointerId !== dragState.id) return;
  // 拖拽结束后抑制紧随的 click，避免误触；点击统一走 @click（兼容移动端 tap）
  if (dragState.moved) {
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
  }
  dragState = null;
}

function onClick() {
  if (suppressClick) return;
  if (!pet) return;
  const pool = pet.actionNames.filter((n) => n !== pet.defaultAction);
  if (!pool.length) return;
  pet.play(pool[Math.floor(Math.random() * pool.length)]);
}

// 按当前语言加载皮肤（en 用英文版）
function skinUrl() {
  return i18n.global.locale.value === 'en'
    ? '/pet/skins/default/skin.en.json'
    : '/pet/skins/default/skin.json';
}

async function mountPet() {
  pet?.destroy();
  pet = null;
  const { createPet } = await import('../pet/pet-adapter.js');
  const created = await createPet(cv.value, bubble.value, skinUrl());
  // await 期间组件可能已卸载，立即销毁避免泄漏
  if (unmounted) { created.destroy(); return; }
  pet = created;
}

onMounted(async () => {
  pos.x = window.innerWidth - wrap.value.offsetWidth - 24;
  pos.y = window.innerHeight - wrap.value.offsetHeight - bottomMargin();
  await mountPet();
});

// 音乐队列异步加载，MiniPlayer 出现（或消失）后移动端桌宠自动让位/回落
watch(() => playerState.queue.length, (len) => {
  if (!isMobile || !wrap.value) return;
  const rect = wrap.value.getBoundingClientRect();
  const limit = window.innerHeight - rect.height - bottomMargin();
  if (len && pos.y > limit) pos.y = limit;
  if (!len) pos.y = limit;
});

// 切换语言时用对应语言的皮肤重建桌宠
watch(() => i18n.global.locale.value, () => {
  if (bubble.value) bubble.value.style.opacity = '0';
  mountPet();
});

onUnmounted(() => {
  unmounted = true;
  pet?.destroy();
  pet = null;
});
</script>

<template>
  <div
    ref="wrap"
    class="desktop-pet"
    :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="dragState = null"
    @click="onClick"
  >
    <div ref="bubble" class="pet-bubble"></div>
    <canvas ref="cv" class="pet-canvas"></canvas>
  </div>
</template>

<style scoped>
.desktop-pet {
  position: fixed;
  z-index: 9999;
  user-select: none;
  touch-action: none;
}
.pet-canvas {
  display: block;
  width: 128px; /* cell 192x208 缩小显示 */
  height: auto;
  image-rendering: pixelated;
  cursor: grab;
}
.desktop-pet:active .pet-canvas {
  cursor: grabbing;
}
.pet-bubble {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: 6px;
  padding: 6px 10px;
  max-width: 180px;
  background: #fff;
  border: 1px solid #e5e5e5;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.4;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}
@media (pointer: coarse) {
  .pet-canvas {
    width: 80px;
    cursor: default;
  }
  .pet-bubble {
    font-size: 12px;
    white-space: normal;
  }
}
</style>
