<script setup>
import { computed, onMounted, onUnmounted } from 'vue';

const props = defineProps({
  photos: { type: Array, default: () => [] }, // [{ filename, caption }]
});
const index = defineModel('index', { type: Number, default: null });

const current = computed(() =>
  index.value === null ? null : props.photos[index.value] || null
);

function close() {
  index.value = null;
}
function prev() {
  if (!props.photos.length) return;
  index.value = (index.value - 1 + props.photos.length) % props.photos.length;
}
function next() {
  if (!props.photos.length) return;
  index.value = (index.value + 1) % props.photos.length;
}
function onKeydown(e) {
  if (index.value === null) return;
  if (e.key === 'Escape') close();
  else if (e.key === 'ArrowLeft') prev();
  else if (e.key === 'ArrowRight') next();
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div v-if="current" class="lightbox" @click.self="close">
    <button class="close" aria-label="关闭" @click="close">&times;</button>
    <button v-if="photos.length > 1" class="arrow left" aria-label="上一张" @click="prev">&#8249;</button>
    <figure class="stage">
      <img :src="`/uploads/${current.filename}`" :alt="current.caption || ''" class="img" />
      <figcaption v-if="current.caption" class="caption">{{ current.caption }}</figcaption>
    </figure>
    <button v-if="photos.length > 1" class="arrow right" aria-label="下一张" @click="next">&#8250;</button>
  </div>
</template>

<style scoped>
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(30, 24, 18, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
}
.stage {
  max-width: 86vw;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.img {
  max-width: 86vw;
  max-height: 76vh;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
}
.caption {
  color: #f3ece2;
  font-size: 14px;
  text-align: center;
}
.close {
  position: absolute;
  top: 16px;
  right: 20px;
  background: none;
  border: none;
  color: #f3ece2;
  font-size: 36px;
  line-height: 1;
  cursor: pointer;
}
.arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(255, 253, 249, 0.12);
  border: none;
  color: #f3ece2;
  font-size: 40px;
  line-height: 1;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.arrow:hover {
  background: rgba(255, 253, 249, 0.25);
}
.arrow.left {
  left: 16px;
}
.arrow.right {
  right: 16px;
}
</style>
