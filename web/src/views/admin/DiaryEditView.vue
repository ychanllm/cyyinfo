<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { marked } from 'marked';
import { api, apiUpload } from '../../api';

const route = useRoute();
const router = useRouter();

// 新建模式无 :id 参数；编辑模式有
const diaryId = computed(() => (route.params.id ? Number(route.params.id) : null));
const isEdit = computed(() => diaryId.value !== null);

const title = ref('');
const slug = ref('');
const content = ref('');
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
const html = computed(() => marked.parse(content.value || ''));

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
    slug.value = d.slug || '';
    content.value = d.content_md || '';
    status.value = d.status || 'draft';
    coverFilename.value = d.cover_filename || '';
    categoryId.value = d.category_id || null;
    versions.value = d.versions || [];
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
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
    error.value = '请输入标题';
    return;
  }
  saving.value = true;
  error.value = '';
  const payload = {
    title: title.value.trim(),
    content_md: content.value,
    slug: slug.value.trim() || null,
    status: targetStatus,
    category_id: categoryId.value,
  };
  try {
    if (isEdit.value) {
      await api(`/admin/diaries/${diaryId.value}`, { method: 'PUT', admin: true, body: payload });
      status.value = targetStatus;
      showSaved(targetStatus === 'published' ? '已发布' : '草稿已保存');
      refreshVersions();
    } else {
      const r = await api('/admin/diaries', { method: 'POST', admin: true, body: payload });
      // 新建保存后跳到编辑页，之后即可上传封面
      router.replace(`/admin/diaries/${r.id}/edit`);
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
</script>

<template>
  <div class="diary-edit">
    <div class="head">
      <h2 class="page-title">{{ isEdit ? '编辑日记' : '写日记' }}</h2>
      <div class="head-actions">
        <span v-if="isEdit" class="badge" :class="status === 'published' ? 'published' : 'draft'">
          {{ status === 'published' ? '已发布' : '草稿' }}
        </span>
        <span v-if="savedTip" class="saved-tip">{{ savedTip }}</span>
        <button class="btn" :disabled="saving" @click="save('draft')">保存草稿</button>
        <button class="btn primary" :disabled="saving" @click="save('published')">
          {{ saving ? '保存中…' : '发布' }}
        </button>
      </div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="hint">加载中…</p>

    <div v-else class="panes">
      <section class="card form-pane">
        <label class="field">
          <span class="label">标题</span>
          <input v-model="title" type="text" placeholder="日记标题" />
        </label>
        <label class="field">
          <span class="label">slug（留空则用文章 ID 访问）</span>
          <input v-model="slug" type="text" placeholder="如 my-first-diary" />
        </label>
        <label class="field">
          <span class="label">分类</span>
          <select v-model="categoryId">
            <option :value="null">未分类</option>
            <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
          </select>
        </label>
        <div class="field">
          <span class="label">封面图</span>
          <div class="cover-row">
            <img v-if="coverFilename" :src="`/uploads/${coverFilename}`" alt="封面预览" class="cover-preview" />
            <label v-if="isEdit" class="btn upload-btn">
              {{ uploading ? '上传中…' : coverFilename ? '更换封面' : '上传封面' }}
              <input type="file" accept="image/*" class="file-input" :disabled="uploading" @change="uploadCover" />
            </label>
            <span v-else class="hint">保存后即可上传封面</span>
          </div>
        </div>
        <label class="field content-field">
          <span class="label">正文（Markdown）</span>
          <textarea v-model="content" placeholder="用 Markdown 记录今天吧…"></textarea>
        </label>
      </section>

      <section class="card preview-pane">
        <span class="label">预览</span>
        <!-- v-html 安全前提：管理员自写的可信内容，首版不做消毒（spec 决策） -->
        <div class="md-body preview-body" v-html="html"></div>
      </section>
    </div>

    <section v-if="isEdit && versions.length" class="card versions-card">
      <span class="label">编辑记录（共 {{ versions.length }} 次）</span>
      <ul class="version-list">
        <li
          v-for="v in versions"
          :key="v.id"
          class="version-item"
          :class="{ latest: v.version === versions.length }"
          :style="{ '--vc': versionColor(v.version) }"
        >
          <span class="dot"></span>
          <span class="v-no">第 {{ v.version }} 次</span>
          <span class="v-time">{{ fmtVersionTime(v.saved_at) }}</span>
          <span v-if="v.version === versions.length" class="v-tag">当前</span>
          <button class="v-view" @click="showVersionId = showVersionId === v.id ? null : v.id">
            {{ showVersionId === v.id ? '收起' : '查看' }}
          </button>
        </li>
      </ul>
      <div v-if="shownVersion" class="version-preview">
        <h4 class="vp-title">{{ shownVersion.title }}</h4>
        <div class="md-body" v-html="marked.parse(shownVersion.content_md || '')"></div>
      </div>
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
@media (max-width: 960px) {
  .panes {
    grid-template-columns: 1fr;
  }
}
</style>
