<script setup>
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, apiUpload } from '../../api';

const { t } = useI18n();
const albums = ref([]);
const loading = ref(true);
const error = ref('');

// 新建相册表单
const newTitle = ref('');
const newTitleEn = ref('');
const newDesc = ref('');
const newDescEn = ref('');
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
    error.value = t('adminPhotos.nameRequired');
    return;
  }
  creating.value = true;
  error.value = '';
  try {
    await api('/admin/albums', {
      method: 'POST',
      admin: true,
      body: {
        title: newTitle.value.trim(),
        title_en: newTitleEn.value.trim(),
        description: newDesc.value.trim(),
        description_en: newDescEn.value.trim(),
      },
    });
    newTitle.value = '';
    newTitleEn.value = '';
    newDesc.value = '';
    newDescEn.value = '';
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
        title_en: album.title_en || '',
        description: album.description || '',
        description_en: album.description_en || '',
        sort_order: Number(album.sort_order) || 0,
      },
    });
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
    const data = await api(`/admin/albums/${album.id}`, { admin: true });
    photos.value = data.photos;
  } catch (e) {
    error.value = e.message;
  } finally {
    photosLoading.value = false;
  }
}

async function reloadPhotos() {
  if (!current.value) return;
  const data = await api(`/admin/albums/${current.value.id}`, { admin: true });
  photos.value = data.photos;
}

// 可移动的目标相册（排除当前相册）
const moveTargets = computed(() => albums.value.filter((a) => a.id !== current.value?.id));

async function movePhoto(photo, targetAlbumId) {
  const target = albums.value.find((a) => a.id === Number(targetAlbumId));
  if (!target) return;
  if (!confirm(t('adminPhotos.confirmMovePhoto', { title: target.title }))) return;
  error.value = '';
  try {
    await api(`/admin/photos/${photo.id}`, {
      method: 'PUT',
      admin: true,
      body: { album_id: target.id },
    });
    // 若移动的是当前相册封面，封面随之清空
    if (current.value?.cover_photo_id === photo.id) {
      current.value.cover_photo_id = null;
      const album = albums.value.find((a) => a.id === current.value.id);
      if (album) album.cover_photo_id = null;
    }
    await reloadPhotos();
  } catch (e) {
    error.value = e.message;
  }
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
      form.append('caption_en', '');
      await apiUpload('/admin/photos', form);
    }
    await reloadPhotos();
  } catch (e) {
    error.value = e.message;
  } finally {
    uploading.value = false;
  }
}

const savingId = ref(null); // 正在保存的照片 id
const savedId = ref(null); // 刚保存完成的照片 id
let saveTimer = null; // 输入防抖定时器
let feedbackTimer = null; // “已保存”提示隐藏定时器

async function saveCaption(photo, e) {
  if (e && e.isComposing) return; // 中文输入法组词期间值尚未提交，跳过
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  savingId.value = photo.id;
  error.value = '';
  try {
    await api(`/admin/photos/${photo.id}`, {
      method: 'PUT',
      admin: true,
      body: {
        caption: photo.caption || '',
        caption_en: photo.caption_en || '',
      },
    });
    savedId.value = photo.id;
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => { savedId.value = null; }, 1600);
  } catch (e) {
    error.value = e.message;
  } finally {
    savingId.value = null;
  }
}

// 输入停顿 600ms 自动保存，避免依赖失焦事件（某些浏览器按回车或直接切走不会触发 change）
function onCaptionInput(photo, e) {
  if (e && e.isComposing) return; // 组词中不保存，compositionend 后会再触发一次 input
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveCaption(photo), 600);
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

// 隐藏/恢复：只改数据库标记，R2 文件保留；隐藏后前台不再显示
async function toggleHidden(photo) {
  error.value = '';
  try {
    await api(`/admin/photos/${photo.id}`, {
      method: 'PUT',
      admin: true,
      body: { hidden: !photo.hidden },
    });
    photo.hidden = photo.hidden ? 0 : 1;
  } catch (e) {
    error.value = e.message;
  }
}

onMounted(loadAlbums);
</script>

<template>
  <div class="photos-view">
    <h2 class="page-title">{{ t('adminPhotos.title') }}</h2>
    <p v-if="error" class="error">{{ error }}</p>

    <section class="card">
      <h3>{{ t('adminPhotos.createAlbum') }}</h3>
      <form class="create-form" @submit.prevent="createAlbum">
        <input v-model="newTitle" type="text" :placeholder="t('adminPhotos.albumName')" />
        <input v-model="newTitleEn" type="text" :placeholder="t('adminPhotos.albumNameEn')" class="en-input" />
        <input v-model="newDesc" type="text" :placeholder="t('adminPhotos.descOptional')" />
        <input v-model="newDescEn" type="text" :placeholder="t('adminPhotos.descOptionalEn')" class="en-input" />
        <button type="submit" :disabled="creating">{{ creating ? t('adminPhotos.creating') : t('adminPhotos.create') }}</button>
      </form>
    </section>

    <section class="card">
      <h3>{{ t('adminPhotos.albumList') }}</h3>
      <p v-if="loading" class="hint">{{ t('adminPhotos.loading') }}</p>
      <p v-else-if="!albums.length" class="hint">{{ t('adminPhotos.noAlbums') }}</p>
      <table v-else class="album-table">
        <thead>
          <tr>
            <th class="col-name">{{ t('adminPhotos.name') }}</th>
            <th class="col-desc">{{ t('adminPhotos.desc') }}</th>
            <th class="col-sort">{{ t('adminPhotos.sort') }}</th>
            <th class="col-actions">{{ t('adminPhotos.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="album in albums" :key="album.id" :class="{ selected: current?.id === album.id }">
            <td class="bi">
              <input v-model="album.title" type="text" :placeholder="t('adminPhotos.zh')" />
              <input v-model="album.title_en" type="text" :placeholder="t('adminPhotos.en')" class="en-input" />
            </td>
            <td class="bi">
              <input v-model="album.description" type="text" :placeholder="t('adminPhotos.none')" />
              <input v-model="album.description_en" type="text" :placeholder="t('adminPhotos.en')" class="en-input" />
            </td>
            <td class="col-sort"><input v-model="album.sort_order" type="number" /></td>
            <td class="col-actions">
              <button class="btn" @click="saveAlbum(album)">{{ t('adminPhotos.save') }}</button>
              <button class="btn primary" @click="selectAlbum(album)">{{ t('adminPhotos.managePhotos') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="current" class="card">
      <div class="photo-head">
        <h3>{{ t('adminPhotos.albumPhotos', { title: current.title }) }}</h3>
        <label class="btn primary upload-btn">
          {{ uploading ? t('adminPhotos.uploading') : t('adminPhotos.upload') }}
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
      <p v-if="photosLoading" class="hint">{{ t('adminPhotos.loading') }}</p>
      <p v-else-if="!photos.length" class="hint">{{ t('adminPhotos.noPhotos') }}</p>
      <div v-else class="grid">
        <div v-for="photo in photos" :key="photo.id" class="cell" :class="{ 'is-hidden': photo.hidden }">
          <div class="img-wrap">
            <img :src="`/uploads/${photo.filename}`" :alt="photo.caption || ''" class="img" loading="lazy" />
            <span class="status-badge" :class="{ hidden: photo.hidden }">
              {{ photo.hidden ? t('adminPhotos.statusHidden') : t('adminPhotos.statusVisible') }}
            </span>
          </div>
          <div class="cell-body">
            <div class="caption-row">
              <input
                v-model="photo.caption"
                type="text"
                :placeholder="t('adminPhotos.zh')"
                @input="onCaptionInput(photo, $event)"
                @keyup.enter="saveCaption(photo, $event)"
                @change="saveCaption(photo, $event)"
              />
              <input
                v-model="photo.caption_en"
                type="text"
                :placeholder="t('adminPhotos.en')"
                class="en-input"
                @input="onCaptionInput(photo, $event)"
                @keyup.enter="saveCaption(photo, $event)"
                @change="saveCaption(photo, $event)"
              />
              <span
                class="save-hint"
                :class="{ saving: savingId === photo.id, saved: savedId === photo.id }"
              >
                {{ savingId === photo.id ? t('adminPhotos.saving') : (savedId === photo.id ? t('adminPhotos.saved') : '') }}
              </span>
            </div>
            <select class="move-select" @change="movePhoto(photo, $event.target.value)">
              <option value="" selected disabled>{{ t('adminPhotos.moveTo') }}</option>
              <option v-for="a in moveTargets" :key="a.id" :value="a.id">{{ a.title }}</option>
            </select>
            <div class="cell-actions">
              <button
                class="btn"
                :class="{ primary: current.cover_photo_id === photo.id }"
                @click="setCover(photo)"
              >
                {{ current.cover_photo_id === photo.id ? t('adminPhotos.currentCover') : t('adminPhotos.setCover') }}
              </button>
              <button class="btn" :class="{ danger: !photo.hidden }" @click="toggleHidden(photo)">
                {{ photo.hidden ? t('adminPhotos.unhide') : t('adminPhotos.hide') }}
              </button>
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
.en-input {
  border-color: #d8cbb9 !important;
  background: #fdfaf5;
}
.hint {
  color: var(--color-text-light);
  font-size: 14px;
}
.album-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  table-layout: fixed;
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
  vertical-align: top;
}
.album-table tr.selected td {
  background: var(--bg-deep);
}
.album-table input {
  width: 100%;
  box-sizing: border-box;
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
/* 中英文两个输入框在单元格内上下排列，td 保持 table-cell 以保证列对齐 */
.album-table .bi input {
  display: block;
}
.album-table .bi input + input {
  margin-top: 4px;
}
.col-name {
  width: 30%;
}
.col-desc {
  width: 30%;
}
.col-sort {
  width: 80px;
}
.col-actions {
  width: 220px;
  white-space: nowrap;
}
.col-actions .btn:last-child {
  margin-right: 0;
}
@media (max-width: 600px) {
  .album-table th,
  .album-table td {
    padding: 6px 4px;
  }
  .col-sort {
    width: 56px;
  }
  /* 窄屏下操作按钮上下堆叠，避免横向溢出 */
  .col-actions {
    width: 84px;
    white-space: normal;
  }
  .col-actions .btn {
    display: block;
    width: 100%;
    margin: 0 0 6px;
    padding: 4px 6px;
    box-sizing: border-box;
  }
  .col-actions .btn:last-child {
    margin-bottom: 0;
  }
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
.cell.is-hidden .img {
  opacity: 0.4;
}
.img-wrap {
  position: relative;
}
.status-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.85);
  color: #1e8e4f;
}
.status-badge.hidden {
  background: rgba(30, 24, 18, 0.75);
  color: #f3ece2;
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
.caption-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
  position: relative;
}
.caption-row input {
  margin-bottom: 0;
}
.caption-row .en-input {
  border-color: #d8cbb9;
  background: #fdfaf5;
}
.save-hint {
  position: absolute;
  right: 8px;
  top: 2px;
  font-size: 12px;
  color: var(--color-text-light);
  white-space: nowrap;
  pointer-events: none;
}
.save-hint.saved {
  color: #27ae60;
}
.cell-body input:focus,
.move-select:focus {
  border-color: var(--color-primary);
}
.move-select {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  color: var(--color-text);
  background: #fff;
  outline: none;
  margin-bottom: 8px;
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
