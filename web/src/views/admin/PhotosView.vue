<script setup>
import { ref, onMounted } from 'vue';
import { api, apiUpload } from '../../api';

const albums = ref([]);
const loading = ref(true);
const error = ref('');

// 新建相册表单
const newTitle = ref('');
const newDesc = ref('');
const creating = ref(false);

// 当前选中的相册及其照片
const current = ref(null);
const photos = ref([]);
const photosLoading = ref(false);
const uploading = ref(false);

async function loadAlbums() {
  loading.value = true;
  error.value = '';
  try {
    albums.value = await api('/admin/albums', { admin: true });
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function createAlbum() {
  if (!newTitle.value.trim()) {
    error.value = '请输入相册名称';
    return;
  }
  creating.value = true;
  error.value = '';
  try {
    await api('/admin/albums', {
      method: 'POST',
      admin: true,
      body: { title: newTitle.value.trim(), description: newDesc.value.trim() },
    });
    newTitle.value = '';
    newDesc.value = '';
    await loadAlbums();
  } catch (e) {
    error.value = e.message;
  } finally {
    creating.value = false;
  }
}

async function saveAlbum(album) {
  error.value = '';
  try {
    await api(`/admin/albums/${album.id}`, {
      method: 'PUT',
      admin: true,
      body: {
        title: album.title.trim(),
        description: album.description || '',
        sort_order: Number(album.sort_order) || 0,
      },
    });
    await loadAlbums();
  } catch (e) {
    error.value = e.message;
  }
}

async function removeAlbum(album) {
  if (!confirm(`确定删除相册「${album.title}」吗？里面的照片也会一起删除。`)) return;
  error.value = '';
  try {
    await api(`/admin/albums/${album.id}`, { method: 'DELETE', admin: true });
    if (current.value?.id === album.id) {
      current.value = null;
      photos.value = [];
    }
    await loadAlbums();
  } catch (e) {
    error.value = e.message;
  }
}

async function selectAlbum(album) {
  current.value = album;
  photosLoading.value = true;
  error.value = '';
  try {
    const data = await api(`/albums/${album.id}`, { admin: true });
    photos.value = data.photos;
  } catch (e) {
    error.value = e.message;
  } finally {
    photosLoading.value = false;
  }
}

async function reloadPhotos() {
  if (!current.value) return;
  const data = await api(`/albums/${current.value.id}`, { admin: true });
  photos.value = data.photos;
}

async function uploadPhotos(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = '';
  if (!files.length || !current.value) return;
  uploading.value = true;
  error.value = '';
  try {
    for (const file of files) {
      const form = new FormData();
      form.append('file', file);
      form.append('album_id', current.value.id);
      form.append('caption', '');
      await apiUpload('/admin/photos', form);
    }
    await reloadPhotos();
  } catch (e) {
    error.value = e.message;
  } finally {
    uploading.value = false;
  }
}

async function saveCaption(photo) {
  error.value = '';
  try {
    await api(`/admin/photos/${photo.id}`, {
      method: 'PUT',
      admin: true,
      body: { caption: photo.caption || '' },
    });
  } catch (e) {
    error.value = e.message;
  }
}

async function setCover(photo) {
  error.value = '';
  try {
    await api(`/admin/albums/${current.value.id}/cover`, {
      method: 'POST',
      admin: true,
      body: { photo_id: photo.id },
    });
    current.value.cover_photo_id = photo.id;
    const album = albums.value.find((a) => a.id === current.value.id);
    if (album) album.cover_photo_id = photo.id;
  } catch (e) {
    error.value = e.message;
  }
}

async function removePhoto(photo) {
  if (!confirm('确定删除这张照片吗？')) return;
  error.value = '';
  try {
    await api(`/admin/photos/${photo.id}`, { method: 'DELETE', admin: true });
    await reloadPhotos();
  } catch (e) {
    error.value = e.message;
  }
}

onMounted(loadAlbums);
</script>

<template>
  <div class="photos-view">
    <h2 class="page-title">照片管理</h2>
    <p v-if="error" class="error">{{ error }}</p>

    <section class="card">
      <h3>新建相册</h3>
      <form class="create-form" @submit.prevent="createAlbum">
        <input v-model="newTitle" type="text" placeholder="相册名称" />
        <input v-model="newDesc" type="text" placeholder="描述（可选）" />
        <button type="submit" :disabled="creating">{{ creating ? '创建中…' : '创建' }}</button>
      </form>
    </section>

    <section class="card">
      <h3>相册列表</h3>
      <p v-if="loading" class="hint">加载中…</p>
      <p v-else-if="!albums.length" class="hint">还没有相册，先创建一个吧</p>
      <table v-else class="album-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>描述</th>
            <th class="col-sort">排序</th>
            <th class="col-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="album in albums" :key="album.id" :class="{ selected: current?.id === album.id }">
            <td><input v-model="album.title" type="text" /></td>
            <td><input v-model="album.description" type="text" placeholder="（无）" /></td>
            <td class="col-sort"><input v-model="album.sort_order" type="number" /></td>
            <td class="col-actions">
              <button class="btn" @click="saveAlbum(album)">保存</button>
              <button class="btn primary" @click="selectAlbum(album)">管理照片</button>
              <button class="btn danger" @click="removeAlbum(album)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="current" class="card">
      <div class="photo-head">
        <h3>「{{ current.title }}」的照片</h3>
        <label class="btn primary upload-btn">
          {{ uploading ? '上传中…' : '上传照片' }}
          <input
            type="file"
            multiple
            accept="image/*"
            class="file-input"
            :disabled="uploading"
            @change="uploadPhotos"
          />
        </label>
      </div>
      <p v-if="photosLoading" class="hint">加载中…</p>
      <p v-else-if="!photos.length" class="hint">这个相册还没有照片</p>
      <div v-else class="grid">
        <div v-for="photo in photos" :key="photo.id" class="cell">
          <img :src="`/uploads/${photo.filename}`" :alt="photo.caption || ''" class="img" loading="lazy" />
          <div class="cell-body">
            <input
              v-model="photo.caption"
              type="text"
              placeholder="照片说明"
              @change="saveCaption(photo)"
            />
            <div class="cell-actions">
              <button
                class="btn"
                :class="{ primary: current.cover_photo_id === photo.id }"
                @click="setCover(photo)"
              >
                {{ current.cover_photo_id === photo.id ? '当前封面' : '设为封面' }}
              </button>
              <button class="btn danger" @click="removePhoto(photo)">删除</button>
            </div>
          </div>
        </div>
      </div>
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
.create-form {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.create-form input {
  flex: 1;
  min-width: 160px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  outline: none;
}
.create-form input:focus {
  border-color: var(--color-primary);
}
.hint {
  color: var(--color-text-light);
  font-size: 14px;
}
.album-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.album-table th {
  text-align: left;
  color: var(--color-text-light);
  font-weight: normal;
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border);
}
.album-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border);
}
.album-table tr.selected td {
  background: var(--bg-deep);
}
.album-table input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  outline: none;
}
.album-table input:focus {
  border-color: var(--color-primary);
  background: #fff;
}
.col-sort {
  width: 80px;
}
.col-actions {
  width: 220px;
  white-space: nowrap;
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
.create-form button {
  border: none;
  border-radius: 8px;
  padding: 10px 20px;
  background: var(--color-primary);
  color: #fff;
  cursor: pointer;
}
.create-form button:disabled {
  opacity: 0.6;
  cursor: default;
}
.photo-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.photo-head h3 {
  margin-bottom: 0;
}
.upload-btn {
  display: inline-block;
  margin-right: 0;
}
.file-input {
  display: none;
}
.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}
@media (max-width: 960px) {
  .grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
@media (max-width: 600px) {
  .grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
.cell {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}
.img {
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  display: block;
  background: var(--bg-deep);
}
.cell-body {
  padding: 8px;
}
.cell-body input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  margin-bottom: 8px;
}
.cell-body input:focus {
  border-color: var(--color-primary);
}
.cell-actions {
  display: flex;
  gap: 6px;
}
.cell-actions .btn {
  flex: 1;
  margin-right: 0;
}
</style>
