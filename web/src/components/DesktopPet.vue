<script setup>
import { onMounted, onUnmounted, reactive, ref } from 'vue';

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

onMounted(async () => {
  pos.x = window.innerWidth - wrap.value.offsetWidth - 24;
  pos.y = window.innerHeight - wrap.value.offsetHeight - 24;
  // public 下的静态资源 URL，运行时原生 ESM 加载（变量形式避免被构建器解析）
  const adapterUrl = '/pet/pet-adapter.js';
  const { createPet } = await import(/* @vite-ignore */ adapterUrl);
  const created = await createPet(cv.value, bubble.value, '/pet/skins/default/skin.json');
  // await 期间组件可能已卸载，立即销毁避免泄漏
  if (unmounted) { created.destroy(); return; }
  pet = created;
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
