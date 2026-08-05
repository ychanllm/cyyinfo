import { reactive } from 'vue';
import { api } from './api';

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

// 进入站点自动播放：随机挑一张有歌的专辑从头播放。
// 只在队列为空时生效（避免打断用户已在播放的音乐），失败静默。
export async function autoPlayMusic() {
  if (state.queue.length) return;
  try {
    const albums = (await api('/music/albums')) || [];
    const candidates = albums.filter((a) => (a.song_count || 0) > 0);
    if (!candidates.length) return;
    const album = candidates[Math.floor(Math.random() * candidates.length)];
    const detail = await api(`/music/albums/${album.id}`);
    const songs = detail?.songs || [];
    if (songs.length) playQueue(songs, 0);
  } catch { /* 自动播放失败不阻塞进入站点 */ }
}

audio.addEventListener('play', () => { state.playing = true; });
audio.addEventListener('pause', () => { state.playing = false; });
audio.addEventListener('ended', () => next());
audio.addEventListener('timeupdate', () => {
  state.currentTime = audio.currentTime;
  state.duration = audio.duration || 0;
});
