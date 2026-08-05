<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { state, toggle, next, prev, seek, setVolume } from '../player';

const { t } = useI18n();
const current = computed(() => state.queue[state.index]);

function fmt(sec) {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
</script>

<template>
  <div v-if="state.queue.length" class="mini-player">
    <div class="inner">
      <div class="info">
        <span class="note">♪</span>
        <span class="title">{{ current?.title || '' }}</span>
      </div>

      <div class="controls">
        <button type="button" class="btn" :title="t('player.prev')" @click="prev">⏮</button>
        <button type="button" class="btn play" :title="state.playing ? t('player.pause') : t('player.play')" @click="toggle">
          {{ state.playing ? '⏸' : '▶' }}
        </button>
        <button type="button" class="btn" :title="t('player.next')" @click="next">⏭</button>
      </div>

      <div class="progress">
        <span class="time">{{ fmt(state.currentTime) }}</span>
        <input
          type="range"
          class="bar"
          :max="state.duration || 0"
          :value="state.currentTime"
          @input="seek($event.target.valueAsNumber)"
        />
        <span class="time">{{ fmt(state.duration) }}</span>
      </div>

      <div class="volume">
        <span class="vol-icon">🔊</span>
        <input
          type="range"
          class="vol-bar"
          min="0"
          max="1"
          step="0.05"
          :value="state.volume"
          @input="setVolume($event.target.valueAsNumber)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.mini-player {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  background: rgba(255, 253, 249, 0.96);
  backdrop-filter: blur(8px);
  border-top: 1px solid var(--color-border);
  box-shadow: 0 -4px 16px rgba(120, 90, 60, 0.1);
}
.inner {
  max-width: 960px;
  margin: 0 auto;
  padding: 10px 20px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
.note {
  color: var(--color-primary);
  font-size: 18px;
}
.title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.controls {
  display: flex;
  align-items: center;
  gap: 4px;
}
.btn {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 16px;
  color: var(--color-text);
  padding: 6px;
  border-radius: 50%;
  line-height: 1;
}
.btn:hover {
  background: var(--bg-deep);
  color: var(--color-primary);
}
.btn.play {
  width: 36px;
  height: 36px;
  background: var(--color-primary);
  color: #fff;
  font-size: 15px;
}
.btn.play:hover {
  background: var(--color-primary-dark);
  color: #fff;
}
.progress {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 2;
  min-width: 0;
}
.bar {
  flex: 1;
  accent-color: var(--color-primary);
  height: 4px;
  cursor: pointer;
}
.time {
  font-size: 12px;
  color: var(--color-text-light);
  font-variant-numeric: tabular-nums;
}
.volume {
  display: flex;
  align-items: center;
  gap: 6px;
}
.vol-icon {
  font-size: 13px;
}
.vol-bar {
  width: 72px;
  accent-color: var(--color-primary);
  height: 4px;
  cursor: pointer;
}
@media (max-width: 720px) {
  .progress {
    display: none;
  }
  .volume {
    display: none;
  }
}
</style>
