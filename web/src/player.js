import { reactive } from 'vue';

const audio = new Audio();

export const state = reactive({
  queue: [], index: -1, playing: false,
  currentTime: 0, duration: 0, volume: 1,
});

function load(i) {
  const song = state.queue[i];
  if (!song) return;
  state.index = i;
  audio.src = `/uploads/${song.filename}`;
  audio.play().catch(() => {});
}

export function playQueue(songs, startIndex = 0) {
  state.queue = songs;
  load(startIndex);
}
export function toggle() {
  if (!state.queue.length) return;
  if (audio.paused) { audio.play().catch(() => {}); } else audio.pause();
}
export const next = () => load((state.index + 1) % state.queue.length);
export const prev = () => load((state.index - 1 + state.queue.length) % state.queue.length);
export const seek = (sec) => { audio.currentTime = sec; };
export const setVolume = (v) => { audio.volume = state.volume = v; };

audio.addEventListener('play', () => { state.playing = true; });
audio.addEventListener('pause', () => { state.playing = false; });
audio.addEventListener('ended', () => next());
audio.addEventListener('timeupdate', () => {
  state.currentTime = audio.currentTime;
  state.duration = audio.duration || 0;
});
