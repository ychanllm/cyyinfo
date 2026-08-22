<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { marked } from 'marked';
import { api, apiUpload } from '../../api';
import { localize } from '../../i18n';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

// 新建模式无 :id 参数；编辑模式有
const diaryId = computed(() => (route.params.id ? Number(route.params.id) : null));
const isEdit = computed(() => diaryId.value !== null);

const title = ref('');
const titleEn = ref('');
const slug = ref('');
const content = ref('');
const contentEn = ref('');
const contentLang = ref('zh'); // 正文编辑标签页：zh / en
const status = ref('draft');
const coverFilename = ref('');
const categories = ref([]); // 分类下拉选项
const categoryId = ref(null); // 选中的分类（null = 未分类）

const loading = ref(false);
const saving = ref(false);
const uploading = ref(false);
const error = ref('');
const savedTip = ref('');
const versions = ref([]); // 编辑版本历史（后端 diary_versions）
const showVersionId = ref(null); // 展开查看某次版本的内容
const comments = ref([]); // 该篇日记的评论（划线评论 + 整篇评论）
const commentsLoading = ref(false);

// 每个版本一个不同的颜色，一眼看出是第几次编辑
const VERSION_COLORS = ['#e74c3c', '#e67e22', '#f1c40f', '#27ae60', '#3498db', '#9b59b6', '#e84393', '#00bcd4'];
function versionColor(version) {
  return VERSION_COLORS[(version - 1) % VERSION_COLORS.length];
}
const shownVersion = computed(() => versions.value.find((v) => v.id === showVersionId.value) || null);

function fmtVersionTime(s) {
  if (!s) return '—';
  const d = new Date(s.endsWith('Z') || s.includes('+') ? s : `${s.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return s;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// v-html 安全前提：content_md 为管理员自写的可信内容，首版不做消毒（spec 决策）。
const activeContent = computed(() => (contentLang.value === 'en' ? contentEn.value : content.value));
const html = computed(() => marked.parse(activeContent.value || ''));

onMounted(async () => {
  // 分类下拉选项（新建与编辑都需要）
  try {
    categories.value = await api('/admin/diary-categories', { admin: true });
  } catch { /* 分类加载失败不阻塞编辑 */ }
  if (!isEdit.value) return;
  loading.value = true;
  error.value = '';
  try {
    const d = await api(`/admin/diaries/${diaryId.value}`, { admin: true });
    title.value = d.title || '';
    titleEn.value = d.title_en || '';
    slug.value = d.slug || '';
    content.value = d.content_md || '';
    contentEn.value = d.content_md_en || '';
    status.value = d.status || 'draft';
    coverFilename.value = d.cover_filename || '';
    categoryId.value = d.category_id || null;
    versions.value = d.versions || [];
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
  // 评论加载失败不阻塞编辑
  commentsLoading.value = true;
  try {
    comments.value = await api(`/admin/messages?target_type=diary&target_id=${diaryId.value}`, { admin: true });
  } catch { /* 忽略 */ } finally {
    commentsLoading.value = false;
  }
});

// 保存后刷新版本历史（PUT 只返回 ok，需再拉一次详情拿最新版本）
async function refreshVersions() {
  if (!isEdit.value) return;
  try {
    const d = await api(`/admin/diaries/${diaryId.value}`, { admin: true });
    versions.value = d.versions || [];
  } catch { /* 刷新失败不阻塞后续保存 */ }
}

function showSaved(msg) {
  savedTip.value = msg;
  setTimeout(() => { savedTip.value = ''; }, 2000);
}

async function save(targetStatus) {
  if (!title.value.trim()) {
    error.value = t('adminDiaryEdit.titleRequired');
    return;
  }
  saving.value = true;
  error.value = '';
  const payload = {
    title: title.value.trim(),
    title_en: titleEn.value.trim(),
    content_md: content.value,
    content_md_en: contentEn.value,
    slug: slug.value.trim() || null,
    status: targetStatus,
    category_id: categoryId.value,
  };
  try {
    if (isEdit.value) {
      await api(`/admin/diaries/${diaryId.value}`, { method: 'PUT', admin: true, body: payload });
      status.value = targetStatus;
      showSaved(targetStatus === 'published' ? t('adminDiaryEdit.publishedTip') : t('adminDiaryEdit.draftSavedTip'));
      refreshVersions();
    } else {
      const r = await api('/admin/diaries', { method: 'POST', admin: true, body: payload });
      // 新建保存后跳到编辑页，之后即可上传封面
      router.replace(localize(`/admin/diaries/${r.id}/edit`));
    }
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

async function uploadCover(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || !isEdit.value) return;
  uploading.value = true;
  error.value = '';
  try {
    const form = new FormData();
    form.append('file', file);
    const r = await apiUpload(`/admin/diaries/${diaryId.value}/cover`, form);
    coverFilename.value = r.cover_filename;
  } catch (e) {
    error.value = e.message;
  } finally {
    uploading.value = false;
  }
}

// ---- 正文工具栏：插图 / 颜色 / 字号（内嵌 HTML，marked 透传）----
const taZh = ref(null);
const taEn = ref(null);
const imageInput = ref(null);

const TEXT_COLORS = [
  { key: 'colorDefault', value: '' },
  { key: '红', value: '#c0392b' },
  { key: '橙', value: '#e67e22' },
  { key: '蓝', value: '#2980b9' },
  { key: '绿', value: '#1e8e4f' },
  { key: '紫', value: '#8e44ad' },
];
const FONT_SIZES = [
  { key: 'sizeDefault', value: '' },
  { key: 'sizeSmall', value: '0.85em' },
  { key: 'sizeLarge', value: '1.25em' },
  { key: 'sizeXLarge', value: '1.5em' },
];

function activeTa() {
  return (contentLang.value === 'en' ? taEn.value : taZh.value);
}
function activeModel() {
  return contentLang.value === 'en' ? contentEn : content;
}

// 在光标处插入文本（插图用）
function insertAtCursor(text) {
  const ta = activeTa();
  const model = activeModel();
  if (!ta) { model.value += text; return; }
  const s = ta.selectionStart ?? model.value.length;
  model.value = model.value.slice(0, s) + text + model.value.slice(s);
}

// 选中文字包裹 <span style="...">（颜色/字号用）
function wrapSelection(style) {
  const ta = activeTa();
  const model = activeModel();
  const s = ta?.selectionStart ?? 0;
  const e = ta?.selectionEnd ?? 0;
  if (!ta || s === e) {
    error.value = t('adminDiaryEdit.selectTextFirst');
    setTimeout(() => { if (error.value === t('adminDiaryEdit.selectTextFirst')) error.value = ''; }, 2000);
    return;
  }
  const sel = model.value.slice(s, e);
  model.value = model.value.slice(0, s) + `<span style="${style}">${sel}</span>` + model.value.slice(e);
}

function pickColor(event) {
  const value = event.target.value;
  event.target.value = '';
  if (!value) return; // 「默认」不包 span，保持原文
  wrapSelection(`color:${value}`);
}
function pickSize(event) {
  const value = event.target.value;
  event.target.value = '';
  if (!value) return;
  wrapSelection(`font-size:${value}`);
}

function triggerImage() {
  if (!isEdit.value) {
    error.value = t('adminDiaryEdit.imageEditOnly');
    setTimeout(() => { if (error.value === t('adminDiaryEdit.imageEditOnly')) error.value = ''; }, 2000);
    return;
  }
  imageInput.value?.click();
}

async function uploadInlineImage(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || !isEdit.value) return;
  uploading.value = true;
  error.value = '';
  try {
    const form = new FormData();
    form.append('file', file);
    const r = await apiUpload(`/admin/diaries/${diaryId.value}/images`, form);
    insertAtCursor(`\n<p align="center"><img src="${r.url}" alt=""></p>\n`);
  } catch (e) {
    error.value = e.message;
  } finally {
    uploading.value = false;
  }
}
</script>

<template>
  <div class="diary-edit">
    <div class="head">
      <h2 class="page-title">{{ isEdit ? t('adminDiaryEdit.editTitle') : t('adminDiaryEdit.newTitle') }}</h2>
      <div class="head-actions">
        <span v-if="isEdit" class="badge" :class="status === 'published' ? 'published' : 'draft'">
          {{ status === 'published' ? t('adminDiaryEdit.published') : t('adminDiaryEdit.draft') }}
        </span>
        <span v-if="savedTip" class="saved-tip">{{ savedTip }}</span>
        <button class="btn" :disabled="saving" @click="save('draft')">{{ t('adminDiaryEdit.saveDraft') }}</button>
        <button class="btn primary" :disabled="saving" @click="save('published')">
          {{ saving ? t('adminDiaryEdit.saving') : t('adminDiaryEdit.publish') }}
        </button>
      </div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="hint">{{ t('adminDiaryEdit.loading') }}</p>

    <div v-else class="panes">
      <section class="card form-pane">
        <label class="field">
          <span class="label">{{ t('adminDiaryEdit.title') }} · {{ t('adminDiaryEdit.zh') }}</span>
          <input v-model="title" type="text" :placeholder="t('adminDiaryEdit.titlePlaceholder')" />
        </label>
        <label class="field">
          <span class="label">{{ t('adminDiaryEdit.title') }} · {{ t('adminDiaryEdit.en') }}</span>
          <input v-model="titleEn" type="text" :placeholder="t('adminDiaryEdit.titlePlaceholderEn')" class="en-input" />
        </label>
        <label class="field">
          <span class="label">{{ t('adminDiaryEdit.slug') }}</span>
          <input v-model="slug" type="text" :placeholder="t('adminDiaryEdit.slugPlaceholder')" />
        </label>
        <label class="field">
          <span class="label">{{ t('adminDiaryEdit.category') }}</span>
          <select v-model="categoryId">
            <option :value="null">{{ t('adminDiaryEdit.uncategorized') }}</option>
            <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
          </select>
        </label>
        <div class="field">
          <span class="label">{{ t('adminDiaryEdit.cover') }}</span>
          <div class="cover-row">
            <img v-if="coverFilename" :src="`/uploads/${coverFilename}`" :alt="t('adminDiaryEdit.coverPreview')" class="cover-preview" />
            <label v-if="isEdit" class="btn upload-btn">
              {{ uploading ? t('adminDiaryEdit.uploading') : coverFilename ? t('adminDiaryEdit.changeCover') : t('adminDiaryEdit.uploadCover') }}
              <input type="file" accept="image/*" class="file-input" :disabled="uploading" @change="uploadCover" />
            </label>
            <span v-else class="hint">{{ t('adminDiaryEdit.coverAfterSave') }}</span>
          </div>
        </div>
        <div class="field content-field">
          <div class="content-head">
            <span class="label">{{ t('adminDiaryEdit.content') }}</span>
            <div class="editor-tools">
              <button type="button" class="tool-btn" :disabled="uploading" @click="triggerImage">
                {{ uploading ? t('adminDiaryEdit.uploading') : t('adminDiaryEdit.insertImage') }}
              </button>
              <select class="tool-select" :title="t('adminDiaryEdit.textColor')" @change="pickColor">
                <option value="">{{ t('adminDiaryEdit.textColor') }}</option>
                <option v-for="c in TEXT_COLORS.slice(1)" :key="c.value" :value="c.value">{{ c.key }}</option>
              </select>
              <select class="tool-select" :title="t('adminDiaryEdit.fontSize')" @change="pickSize">
                <option value="">{{ t('adminDiaryEdit.fontSize') }}</option>
                <option v-for="s in FONT_SIZES.slice(1)" :key="s.value" :value="s.value">{{ t(`adminDiaryEdit.${s.key}`) }}</option>
              </select>
              <input ref="imageInput" type="file" accept="image/*" class="file-input" @change="uploadInlineImage" />
            </div>
            <div class="lang-tabs">
              <button type="button" :class="{ active: contentLang === 'zh' }" @click="contentLang = 'zh'">{{ t('adminDiaryEdit.zh') }}</button>
              <button type="button" :class="{ active: contentLang === 'en' }" @click="contentLang = 'en'">{{ t('adminDiaryEdit.en') }}</button>
            </div>
          </div>
          <textarea
            v-if="contentLang === 'zh'"
            ref="taZh"
            v-model="content"
            :placeholder="t('adminDiaryEdit.contentPlaceholder')"
          ></textarea>
          <textarea
            v-else
            ref="taEn"
            v-model="contentEn"
            :placeholder="t('adminDiaryEdit.contentPlaceholderEn')"
          ></textarea>
        </div>
      </section>

      <section class="card preview-pane">
        <span class="label">{{ t('adminDiaryEdit.preview') }}</span>
        <!-- v-html 安全前提：管理员自写的可信内容，首版不做消毒（spec 决策） -->
        <div class="md-body preview-body" v-html="html"></div>
      </section>
    </div>

    <section v-if="isEdit && versions.length" class="card versions-card">
      <span class="label">{{ t('adminDiaryEdit.versionCount', { n: versions.length }) }}</span>
      <ul class="version-list">
        <li
          v-for="v in versions"
          :key="v.id"
          class="version-item"
          :class="{ latest: v.version === versions.length }"
          :style="{ '--vc': versionColor(v.version) }"
        >
          <span class="dot"></span>
          <span class="v-no">{{ t('adminDiaryEdit.versionNo', { n: v.version }) }}</span>
          <span class="v-time">{{ fmtVersionTime(v.saved_at) }}</span>
          <span v-if="v.version === versions.length" class="v-tag">{{ t('adminDiaryEdit.current') }}</span>
          <button class="v-view" @click="showVersionId = showVersionId === v.id ? null : v.id">
            {{ showVersionId === v.id ? t('adminDiaryEdit.collapse') : t('adminDiaryEdit.view') }}
          </button>
        </li>
      </ul>
      <div v-if="shownVersion" class="version-preview">
        <h4 class="vp-title">{{ shownVersion.title }}</h4>
        <div class="md-body" v-html="marked.parse(shownVersion.content_md || '')"></div>
      </div>
    </section>

    <section v-if="isEdit" class="card comments-card">
      <span class="label">{{ t('adminDiaryEdit.commentsTitle', { n: comments.length }) }}</span>
      <p v-if="commentsLoading" class="hint">{{ t('adminDiaryEdit.loading') }}</p>
      <p v-else-if="!comments.length" class="hint">{{ t('adminDiaryEdit.commentsEmpty') }}</p>
      <ul v-else class="comment-list">
        <li v-for="m in comments" :key="m.id" class="comment-item">
          <blockquote v-if="m.quote_text" class="comment-quote">{{ m.quote_text }}</blockquote>
          <div class="comment-main">
            <span class="comment-nick">{{ m.nickname }}</span>
            <span class="comment-content">{{ m.content }}</span>
            <span class="comment-time">{{ fmtVersionTime(m.created_at) }}</span>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  gap: 12px;
  flex-wrap: wrap;
}
.page-title {
  font-size: 22px;
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.saved-tip {
  color: #1e8e4f;
  font-size: 13px;
}
.badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
}
.badge.published {
  background: #e6f6ec;
  color: #1e8e4f;
}
.badge.draft {
  background: var(--bg-deep);
  color: var(--color-text-light);
}
.error {
  color: #c0392b;
  font-size: 14px;
  margin-bottom: 16px;
}
.hint {
  color: var(--color-text-light);
  font-size: 13px;
}
.panes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  align-items: start;
}
.card {
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 20px 24px;
}
.field {
  display: block;
  margin-bottom: 16px;
}
.label {
  display: block;
  font-size: 13px;
  color: var(--color-text-light);
  margin-bottom: 6px;
}
.field input,
.field select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  outline: none;
  background: #fff;
}
.field input:focus,
.field select:focus,
.field textarea:focus {
  border-color: var(--color-primary);
}
.en-input {
  border-color: #d8cbb9 !important;
  background: #fdfaf5;
}
.content-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.content-head .label {
  margin-bottom: 0;
}
.lang-tabs {
  display: flex;
  gap: 4px;
}
.lang-tabs button {
  border: 1px solid var(--color-border);
  background: #fff;
  border-radius: 6px;
  padding: 2px 10px;
  font-size: 12px;
  color: var(--color-text-light);
  cursor: pointer;
}
.lang-tabs button.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
.editor-tools {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  margin-right: 8px;
}
.tool-btn,
.tool-select {
  border: 1px solid var(--color-border);
  background: #fff;
  border-radius: 6px;
  padding: 2px 10px;
  font-size: 12px;
  color: var(--color-text-light);
  cursor: pointer;
}
.tool-btn:hover,
.tool-select:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.cover-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.cover-preview {
  width: 120px;
  height: 80px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  display: block;
}
.upload-btn {
  display: inline-block;
  margin-right: 0;
}
.file-input {
  display: none;
}
.content-field textarea {
  width: 100%;
  min-height: 380px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  outline: none;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 14px;
  line-height: 1.7;
}
.preview-body {
  min-height: 380px;
  padding-top: 4px;
}
.btn {
  border: 1px solid var(--color-border);
  background: #fff;
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
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
.btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.versions-card {
  margin-top: 20px;
}
.version-list {
  list-style: none;
  margin-top: 10px;
}
.version-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-left: 3px solid var(--vc);
  border-radius: 4px;
  margin-bottom: 6px;
  background: var(--bg-deep);
  font-size: 13px;
}
.version-item.latest {
  background: #fff8e6;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--vc);
  flex-shrink: 0;
}
.v-no {
  font-weight: 600;
  color: var(--color-text);
}
.v-time {
  color: var(--color-text-light);
}
.v-tag {
  margin-left: auto;
  font-size: 12px;
  color: #1e8e4f;
  background: #e6f6ec;
  padding: 1px 8px;
  border-radius: 999px;
  flex-shrink: 0;
}
.v-view {
  border: 1px solid var(--color-border);
  background: #fff;
  border-radius: 6px;
  padding: 2px 10px;
  font-size: 12px;
  cursor: pointer;
  color: var(--color-text);
  flex-shrink: 0;
}
.v-view:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.version-preview {
  margin-top: 12px;
  padding: 14px 16px;
  border: 1px dashed var(--color-border);
  border-radius: 8px;
  background: var(--color-card);
}
.vp-title {
  font-size: 16px;
  margin-bottom: 8px;
}
.comments-card {
  margin-top: 20px;
}
.comment-list {
  list-style: none;
  margin-top: 10px;
}
.comment-item {
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border);
  font-size: 14px;
}
.comment-item:last-child {
  border-bottom: none;
}
.comment-quote {
  margin: 0 0 6px;
  padding: 4px 10px;
  border-left: 3px solid var(--color-primary);
  background: var(--bg-deep);
  border-radius: 4px;
  color: var(--color-text-light);
  font-size: 13px;
}
.comment-main {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.comment-nick {
  font-weight: 600;
  color: var(--color-text);
}
.comment-content {
  flex: 1;
  min-width: 200px;
}
.comment-time {
  color: var(--color-text-light);
  font-size: 13px;
  white-space: nowrap;
}
@media (max-width: 960px) {
  .panes {
    grid-template-columns: 1fr;
  }
}
</style>
