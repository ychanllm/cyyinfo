<script setup>
import { ref, onMounted } from 'vue';
import { api, apiUpload } from '../../api';

const albums = ref([]);
const loading = ref(true);
const error = ref('');

// 当前展开的专辑及其歌曲
const current = ref(null);
const songs = ref([]);
const songsLoading = ref(false);

// 上传歌曲表单
const songFile = ref(null);
const songTitle = ref('');
const songTrackNo = ref(0);
const uploading = ref(false);

async function loadAlbums() {
  loading.value = true;
  error.value = '';
  try {
    albums.value = await api('/admin/music/albums', { admin: true });
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function saveAlbum(album) {
  error.value = '';
  try {
    await api(`/admin/music/albums/${album.id}`, {
      method: 'PUT',
      admin: true,
      body: {
        title: album.title.trim(),
        year: Number(album.year) || null,
        sort_order: Number(album.sort_order) || 0,
      },
    });
    await loadAlbums();
  } catch (e) {
    error.value = e.message;
  }
}

async function uploadCover(album, event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  error.value = '';
  try {
    const form = new FormData();
    form.append('file', file);
    const data = await apiUpload(`/admin/music/albums/${album.id}/cover`, form);
    album.cover_filename = data.cover_filename;
  } catch (e) {
    error.value = e.message;
  }
}

async function toggleAlbum(album) {
  if (current.value?.id === album.id) {
    current.value = null;
    songs.value = [];
    return;
  }
  current.value = album;
  songsLoading.value = true;
  error.value = '';
  try {
    const data = await api(`/music/albums/${album.id}`, { admin: true });
    songs.value = data.songs;
  } catch (e) {
    error.value = e.message;
  } finally {
    songsLoading.value = false;
  }
}

async function reloadSongs() {
  if (!current.value) return;
  const data = await api(`/music/albums/${current.value.id}`, { admin: true });
  songs.value = data.songs;
}

function pickSong(event) {
  songFile.value = event.target.files?.[0] || null;
}

async function uploadSong() {
  if (!songFile.value) {
    error.value = '请选择音频文件';
    return;
  }
  if (!songTitle.value.trim()) {
    error.value = '请输入歌名';
    return;
  }
  uploading.value = true;
  error.value = '';
  try {
    const form = new FormData();
    form.append('file', songFile.value);
    form.append('album_id', current.value.id);
    form.append('title', songTitle.value.trim());
    form.append('track_no', String(Number(songTrackNo.value) || 0));
    await apiUpload('/admin/music/songs', form);
    songFile.value = null;
    songTitle.value = '';
    songTrackNo.value = 0;
    document.getElementById('song-file-input').value = '';
    await reloadSongs();
  } catch (e) {
    error.value = e.message;
  } finally {
    uploading.value = false;
  }
}

async function saveSong(song) {
  error.value = '';
  try {
    await api(`/admin/music/songs/${song.id}`, {
      method: 'PUT',
      admin: true,
      body: { title: song.title.trim(), track_no: Number(song.track_no) || 0 },
    });
    await reloadSongs();
  } catch (e) {
    error.value = e.message;
  }
}

async function removeSong(song) {
  if (!confirm(`确定删除歌曲「${song.title}」吗？`)) return;
  error.value = '';
  try {
    await api(`/admin/music/songs/${song.id}`, { method: 'DELETE', admin: true });
    await reloadSongs();
  } catch (e) {
    error.value = e.message;
  }
}

onMounted(loadAlbums);
</script>

<template>
  <div class="music-view">
    <h2 class="page-title">音乐管理</h2>
    <p v-if="error" class="error">{{ error }}</p>

    <section class="card">
      <h3>专辑列表</h3>
      <p v-if="loading" class="hint">加载中…</p>
      <div v-else class="album-grid">
        <div
          v-for="album in albums"
          :key="album.id"
          class="album-card"
          :class="{ selected: current?.id === album.id }"
        >
          <img
            v-if="album.cover_filename"
            :src="`/uploads/${album.cover_filename}`"
            :alt="album.title"
            class="cover"
          />
          <div v-else class="cover placeholder">暂无封面</div>
          <div class="album-body">
            <label class="field">
              名称
              <input v-model="album.title" type="text" />
            </label>
            <div class="field-row">
              <label class="field">
                年份
                <input v-model="album.year" type="number" />
              </label>
              <label class="field">
                排序
                <input v-model="album.sort_order" type="number" />
              </label>
            </div>
            <div class="album-actions">
              <button class="btn" @click="saveAlbum(album)">保存</button>
              <label class="btn upload-btn">
                上传封面
                <input type="file" accept="image/*" class="file-input" @change="uploadCover(album, $event)" />
              </label>
              <button class="btn primary" @click="toggleAlbum(album)">
                {{ current?.id === album.id ? '收起' : '管理歌曲' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section v-if="current" class="card">
      <h3>「{{ current.title }}」的歌曲</h3>
      <form class="upload-form" @submit.prevent="uploadSong">
        <input
          id="song-file-input"
          type="file"
          accept="audio/mpeg,audio/mp4"
          @change="pickSong"
        />
        <input v-model="songTitle" type="text" placeholder="歌名" />
        <input v-model="songTrackNo" type="number" placeholder="曲目号" class="track-input" />
        <button type="submit" :disabled="uploading">{{ uploading ? '上传中…' : '上传歌曲' }}</button>
      </form>

      <p v-if="songsLoading" class="hint">加载中…</p>
      <p v-else-if="!songs.length" class="hint">这张专辑还没有歌曲</p>
      <table v-else class="song-table">
        <thead>
          <tr>
            <th class="col-track">曲目号</th>
            <th>歌名</th>
            <th class="col-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="song in songs" :key="song.id">
            <td class="col-track"><input v-model="song.track_no" type="number" /></td>
            <td><input v-model="song.title" type="text" /></td>
            <td class="col-actions">
              <button class="btn" @click="saveSong(song)">保存</button>
              <button class="btn danger" @click="removeSong(song)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.page-title {
  font-size: 22px;
  margin-bottom: 20px;
}
.error {
  color: #c0392b;
  font-size: 14px;
  margin-bottom: 16px;
}
.card {
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 20px 24px;
  margin-bottom: 24px;
}
.card h3 {
  font-size: 16px;
  margin-bottom: 14px;
}
.hint {
  color: var(--color-text-light);
  font-size: 14px;
}
.album-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
@media (max-width: 960px) {
  .album-grid {
    grid-template-columns: 1fr;
  }
}
.album-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}
.album-card.selected {
  border-color: var(--color-primary);
}
.cover {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  display: block;
  background: var(--bg-deep);
}
.cover.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-light);
  font-size: 14px;
}
.album-body {
  padding: 12px;
}
.field {
  display: block;
  font-size: 13px;
  color: var(--color-text-light);
  margin-bottom: 8px;
}
.field input {
  display: block;
  width: 100%;
  margin-top: 4px;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  outline: none;
}
.field input:focus {
  border-color: var(--color-primary);
}
.field-row {
  display: flex;
  gap: 8px;
}
.field-row .field {
  flex: 1;
}
.album-actions {
  display: flex;
  gap: 6px;
}
.album-actions .btn {
  flex: 1;
  margin-right: 0;
}
.btn {
  border: 1px solid var(--color-border);
  background: #fff;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
  margin-right: 6px;
  text-align: center;
}
.btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.btn.primary {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
.btn.primary:hover {
  background: var(--color-primary-dark);
}
.btn.danger:hover {
  border-color: #c0392b;
  color: #c0392b;
}
.upload-btn {
  display: inline-block;
}
.file-input {
  display: none;
}
.upload-form {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: 16px;
}
.upload-form input[type='text'] {
  flex: 1;
  min-width: 160px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  outline: none;
}
.upload-form input[type='text']:focus {
  border-color: var(--color-primary);
}
.track-input {
  width: 90px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  outline: none;
}
.upload-form button {
  border: none;
  border-radius: 8px;
  padding: 10px 20px;
  background: var(--color-primary);
  color: #fff;
  cursor: pointer;
}
.upload-form button:disabled {
  opacity: 0.6;
  cursor: default;
}
.song-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.song-table th {
  text-align: left;
  color: var(--color-text-light);
  font-weight: normal;
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border);
}
.song-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border);
}
.song-table input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  outline: none;
}
.song-table input:focus {
  border-color: var(--color-primary);
  background: #fff;
}
.col-track {
  width: 90px;
}
.col-actions {
  width: 160px;
  white-space: nowrap;
}
</style>
