<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { marked } from 'marked';
import { api } from '../api';
import { localize } from '../i18n';
import { fmtDateFull } from '../utils/date';
import { reportView } from '../utils/views';
import MessageBoard from '../components/MessageBoard.vue';
import LikeButton from '../components/LikeButton.vue';

const { t } = useI18n();
const route = useRoute();

const diary = ref(null);
const loading = ref(true);
const error = ref('');
const likeState = ref({ count: 0, liked: false });

// v-html 安全前提：content_md 为管理员自写的可信内容，首版不做消毒（spec 决策）。
const html = computed(() => (diary.value ? marked.parse(diary.value.content_md || '') : ''));

// ---- 划线评论 ----
const bodyEl = ref(null);
// 选区附近浮出的「评论」按钮：{x, y}（fixed 定位坐标）
const selBtn = ref(null);
const selText = ref('');
// 提交小窗
const quoteForm = ref({ open: false, x: 0, y: 0, quote: '', nickname: '', content: '', submitting: false, error: '' });
// 提交成功后的短暂提示
const quoteNotice = ref('');
// 高亮气泡
const popover = ref({ open: false, x: 0, y: 0, quote: '', comments: [] });
// 该篇日记的全部已审核评论（含回复），用于气泡内楼中楼展示
const allComments = ref([]);
// 气泡内评论点赞状态：id -> { count, liked }
const popLikes = ref({});
// 气泡内内联回复表单
const popReply = ref({ forId: null, nickname: '', content: '', submitting: false, error: '' });
// quote_text -> 该句的已审核评论列表
let quoteMap = new Map();

function clampX(x) {
  return Math.min(Math.max(x, 12), Math.max(12, window.innerWidth - 240));
}

function onSelect() {
  // 等浏览器完成本次选区更新再读 selection
  setTimeout(() => {
    const sel = window.getSelection();
    const text = sel && !sel.isCollapsed ? sel.toString().trim() : '';
    if (!text || !bodyEl.value || !bodyEl.value.contains(sel.anchorNode)) {
      selBtn.value = null;
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    selText.value = text;
    selBtn.value = { x: clampX(rect.left + rect.width / 2 - 40), y: rect.top - 38 };
  }, 0);
}

function openQuoteForm() {
  if (!selBtn.value) return;
  quoteForm.value = {
    open: true,
    x: selBtn.value.x,
    y: selBtn.value.y + 44,
    quote: selText.value,
    nickname: '',
    content: '',
    submitting: false,
    error: '',
  };
  selBtn.value = null;
}

function closeQuoteForm() {
  quoteForm.value.open = false;
}

async function submitQuote() {
  const f = quoteForm.value;
  f.error = '';
  if (!f.nickname.trim() || !f.content.trim()) {
    f.error = t('board.required');
    return;
  }
  f.submitting = true;
  try {
    await api('/messages', {
      method: 'POST',
      body: {
        nickname: f.nickname.trim(),
        content: f.content.trim(),
        target_type: 'diary',
        target_id: diary.value.id,
        quote_text: f.quote,
      },
    });
    f.open = false;
    quoteNotice.value = t('board.published');
    setTimeout(() => { quoteNotice.value = ''; }, 3000);
    // 评论免审核，立即重新拉取并重画高亮
    await loadQuoteComments();
  } catch (e) {
    f.error = e.message;
  } finally {
    f.submitting = false;
  }
}

// 在正文 DOM 中把每条引用原句包上 <mark class="quote-mark">（出现多次全部高亮）
// 匹配在「所有文本节点拼接并去除空白」的整体文本上进行：
// 兼容选句跨文本节点（加粗/链接等内联标签）及跨段落（选区 toString 带 \n 而正文无）的情况
function highlightQuotes() {
  const el = bodyEl.value;
  if (!el || !quoteMap.size) return;
  // 长句优先，避免短句先高亮后长句跨 mark 匹配不上
  const quotes = [...quoteMap.keys()].sort((a, b) => b.length - a.length);
  for (const quote of quotes) {
    const needle = quote.replace(/\s+/g, '');
    if (!needle) continue;
    // 每条引用重新收集：跳过已有 mark 内的文本节点，避免重复高亮
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue.replace(/\s+/g, '')) return NodeFilter.FILTER_REJECT;
        if (node.parentElement.closest('mark.quote-mark')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    if (!nodes.length) continue;
    // 拼接去空白文本，indexMap[i] 记录第 i 个字符所在节点及节点内偏移
    let haystack = '';
    const indexMap = [];
    nodes.forEach((node, ni) => {
      const text = node.nodeValue;
      for (let i = 0; i < text.length; i++) {
        if (/\s/.test(text[i])) continue;
        indexMap.push({ ni, offset: i });
        haystack += text[i];
      }
    });
    // 找出所有匹配，换算成各文本节点上需要高亮的区间（含区间内空白，保证视觉连续）
    const rangesByNode = new Map(); // ni -> [ [start, endExclusive), ... ]
    let from = 0;
    for (;;) {
      const idx = haystack.indexOf(needle, from);
      if (idx === -1) break;
      const end = idx + needle.length;
      let p = idx;
      while (p < end) {
        const { ni, offset } = indexMap[p];
        let last = offset;
        p++;
        while (p < end && indexMap[p].ni === ni) {
          last = indexMap[p].offset;
          p++;
        }
        const ranges = rangesByNode.get(ni) || [];
        ranges.push([offset, last + 1]);
        rangesByNode.set(ni, ranges);
      }
      from = end;
    }
    // 逐节点拆分并包 mark
    for (const [ni, ranges] of rangesByNode) {
      const node = nodes[ni];
      const text = node.nodeValue;
      ranges.sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const r of ranges) {
        const prev = merged[merged.length - 1];
        if (prev && r[0] <= prev[1]) prev[1] = Math.max(prev[1], r[1]);
        else merged.push([...r]);
      }
      const frag = document.createDocumentFragment();
      let pos = 0;
      for (const [s, e] of merged) {
        frag.append(text.slice(pos, s));
        const mark = document.createElement('mark');
        mark.className = 'quote-mark';
        mark.textContent = text.slice(s, e);
        mark.dataset.quote = quote;
        frag.append(mark);
        pos = e;
      }
      frag.append(text.slice(pos));
      node.parentNode.replaceChild(frag, node);
    }
  }
}

// 事件委托：点击正文中的高亮弹出评论气泡
async function onBodyClick(e) {
  const mark = e.target.closest?.('mark.quote-mark');
  if (!mark || !bodyEl.value.contains(mark)) return;
  const rect = mark.getBoundingClientRect();
  const quote = mark.dataset.quote;
  popReply.value = { forId: null, nickname: '', content: '', submitting: false, error: '' };
  popover.value = {
    open: true,
    x: clampX(rect.left),
    y: rect.bottom + 8,
    quote,
    comments: quoteMap.get(quote) || [],
  };
  // 批量拉取气泡内所有评论（含回复）的点赞计数
  const ids = popover.value.comments.flatMap((c) => [c.id, ...popRepliesOf(c.id).map((r) => r.id)]);
  if (ids.length) {
    try {
      popLikes.value = await api(`/likes/batch?target_type=message&ids=${ids.join(',')}`);
    } catch { /* 点赞计数加载失败不阻塞气泡展示 */ }
  }
}

// 气泡内某条评论的回复（后端已保证回复的回复挂到顶级划线评论）
function popRepliesOf(id) {
  return allComments.value.filter((m) => m.parent_id === id).sort((a, b) => a.id - b.id);
}

function popLikeState(id) {
  return popLikes.value[id] || { count: 0, liked: false };
}

function openPopReply(c) {
  popReply.value = { forId: c.id, nickname: '', content: '', submitting: false, error: '' };
}

// 气泡内回复划线评论：带 parent_id，回复本身不带 quote_text（后端也会强制置空）
async function submitPopReply(c) {
  const f = popReply.value;
  f.error = '';
  if (!f.nickname.trim() || !f.content.trim()) {
    f.error = t('board.required');
    return;
  }
  f.submitting = true;
  try {
    await api('/messages', {
      method: 'POST',
      body: {
        nickname: f.nickname.trim(),
        content: f.content.trim(),
        target_type: 'diary',
        target_id: diary.value.id,
        parent_id: c.id,
      },
    });
    popReply.value = { forId: null, nickname: '', content: '', submitting: false, error: '' };
    quoteNotice.value = t('board.published');
    setTimeout(() => { quoteNotice.value = ''; }, 3000);
    await loadQuoteComments();
    // 刷新气泡内容与点赞计数
    popover.value.comments = quoteMap.get(popover.value.quote) || [];
    const ids = popover.value.comments.flatMap((x) => [x.id, ...popRepliesOf(x.id).map((r) => r.id)]);
    if (ids.length) {
      try {
        popLikes.value = await api(`/likes/batch?target_type=message&ids=${ids.join(',')}`);
      } catch { /* 忽略 */ }
    }
  } catch (e) {
    f.error = e.message;
  } finally {
    f.submitting = false;
  }
}

// 点击气泡/小窗外部时关闭
function onDocClick(e) {
  if (popover.value.open && !e.target.closest?.('.quote-popover') && !e.target.closest?.('mark.quote-mark')) {
    popover.value.open = false;
  }
  if (selBtn.value && !e.target.closest?.('.sel-comment-btn')) {
    selBtn.value = null;
  }
}

// 拉取划线评论并重画高亮（highlightQuotes 会跳过已有 mark，只补新高亮）
async function loadQuoteComments() {
  const list = await api(`/messages?target_type=diary&target_id=${diary.value.id}`);
  allComments.value = list;
  quoteMap = new Map();
  for (const m of list) {
    if (!m.quote_text) continue;
    if (!quoteMap.has(m.quote_text)) quoteMap.set(m.quote_text, []);
    quoteMap.get(m.quote_text).push(m);
  }
  highlightQuotes();
}

onMounted(async () => {
  try {
    diary.value = await api(`/diaries/${route.params.slugOrId}`);
  } catch (e) {
    error.value = e.message || '加载失败';
  } finally {
    // 先结束 loading 让正文（bodyEl 所在分支）渲染出来，再拉评论做高亮
    loading.value = false;
  }
  if (diary.value) {
    reportView('diary', diary.value.id);
    try {
      likeState.value = await api(`/likes?target_type=diary&target_id=${diary.value.id}`);
    } catch { /* 点赞计数加载失败不阻塞阅读 */ }
    // 等 v-html 渲染完成后再操作正文 DOM 做高亮
    await nextTick();
    await loadQuoteComments();
  }
  document.addEventListener('click', onDocClick);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
});
</script>

<template>
  <div class="diary-detail">
    <router-link :to="localize('/diaries')" class="back">&larr; {{ t('diaryDetail.back') }}</router-link>

    <p v-if="loading" class="hint">{{ t('diaryDetail.loading') }}</p>
    <p v-else-if="error" class="hint">{{ error }}</p>

    <template v-else-if="diary">
      <article class="article">
        <img
          v-if="diary.cover_filename"
          :src="`/uploads/${diary.cover_filename}`"
          :alt="diary.title"
          class="cover"
        />
        <h1 class="title">{{ diary.title }}</h1>
        <p class="meta">
          <router-link
            v-if="diary.category_name"
            :to="localize(`/diaries?category=${diary.category_id}`)"
            class="cat-badge"
          >{{ diary.category_name }}</router-link>
          {{ diary.author }} · {{ fmtDateFull(diary.published_at) }}
        </p>
        <div ref="bodyEl" class="md-body" v-html="html" @mouseup="onSelect" @click="onBodyClick"></div>
      </article>
      <div class="like-row">
        <LikeButton
          target-type="diary"
          :target-id="diary.id"
          :count="likeState.count"
          :liked="likeState.liked"
          @update="likeState = $event"
        />
      </div>
      <MessageBoard targetType="diary" :targetId="diary.id" />

      <!-- 选中文本后浮出的「评论」按钮 -->
      <button
        v-if="selBtn"
        class="sel-comment-btn"
        :style="{ left: selBtn.x + 'px', top: selBtn.y + 'px' }"
        @mousedown.prevent
        @click="openQuoteForm"
      >{{ t('diaryDetail.addComment') }}</button>

      <!-- 划线评论提交小窗 -->
      <div
        v-if="quoteForm.open"
        class="quote-form"
        :style="{ left: quoteForm.x + 'px', top: quoteForm.y + 'px' }"
      >
        <p class="qf-quote">&ldquo;{{ quoteForm.quote }}&rdquo;</p>
        <input
          v-model="quoteForm.nickname"
          type="text"
          :placeholder="t('board.nickPlaceholder')"
          maxlength="20"
        />
        <textarea
          v-model="quoteForm.content"
          rows="3"
          :placeholder="t('board.contentPlaceholder')"
          maxlength="500"
        ></textarea>
        <p v-if="quoteForm.error" class="qf-error">{{ quoteForm.error }}</p>
        <div class="qf-actions">
          <button type="button" class="qf-cancel" @click="closeQuoteForm">{{ t('diaryDetail.cancel') }}</button>
          <button type="button" class="qf-submit" :disabled="quoteForm.submitting" @click="submitQuote">
            {{ quoteForm.submitting ? t('board.submitting') : t('board.submit') }}
          </button>
        </div>
      </div>

      <!-- 提交成功提示 -->
      <p v-if="quoteNotice" class="quote-notice">{{ quoteNotice }}</p>

      <!-- 点击高亮弹出的评论气泡 -->
      <div
        v-if="popover.open"
        class="quote-popover"
        :style="{ left: popover.x + 'px', top: popover.y + 'px' }"
      >
        <p class="qp-quote">&ldquo;{{ popover.quote }}&rdquo;</p>
        <ul class="qp-list">
          <li v-for="c in popover.comments" :key="c.id" class="qp-item">
            <span class="qp-nick">{{ c.nickname }}</span>
            <span class="qp-text">{{ c.content }}</span>
            <div class="qp-actions">
              <LikeButton
                target-type="message"
                :target-id="c.id"
                :count="popLikeState(c.id).count"
                :liked="popLikeState(c.id).liked"
                @update="popLikes[c.id] = $event"
              />
              <button type="button" class="qp-reply-btn" @click="popReply.forId === c.id ? (popReply.forId = null) : openPopReply(c)">
                {{ t('board.reply') }}
              </button>
            </div>
            <div v-if="popReply.forId === c.id" class="qp-reply-form">
              <input v-model="popReply.nickname" type="text" :placeholder="t('board.nickPlaceholder')" maxlength="20" />
              <textarea v-model="popReply.content" rows="2" :placeholder="t('board.contentPlaceholder')" maxlength="500"></textarea>
              <p v-if="popReply.error" class="qf-error">{{ popReply.error }}</p>
              <div class="qf-actions">
                <button type="button" class="qf-cancel" @click="popReply.forId = null">{{ t('diaryDetail.cancel') }}</button>
                <button type="button" class="qf-submit" :disabled="popReply.submitting" @click="submitPopReply(c)">
                  {{ popReply.submitting ? t('board.submitting') : t('board.submit') }}
                </button>
              </div>
            </div>
            <ul v-if="popRepliesOf(c.id).length" class="qp-reply-list">
              <li v-for="r in popRepliesOf(c.id)" :key="r.id" class="qp-item">
                <span class="qp-nick">{{ r.nickname }}</span>
                <span class="qp-text">{{ r.content }}</span>
                <div class="qp-actions">
                  <LikeButton
                    target-type="message"
                    :target-id="r.id"
                    :count="popLikeState(r.id).count"
                    :liked="popLikeState(r.id).liked"
                    @update="popLikes[r.id] = $event"
                  />
                  <button type="button" class="qp-reply-btn" @click="popReply.forId === c.id ? (popReply.forId = null) : openPopReply(c)">
                    {{ t('board.reply') }}
                  </button>
                </div>
              </li>
            </ul>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>

<style scoped>
.diary-detail {
  max-width: 680px;
  margin: 0 auto;
}
.back {
  display: inline-block;
  font-size: 14px;
  margin-bottom: 16px;
}
.hint {
  color: var(--color-text-light);
  font-size: 14px;
  text-align: center;
  padding: 32px 0;
}
.article {
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 32px 36px;
  margin-bottom: 24px;
}
.cover {
  width: 100%;
  border-radius: 8px;
  display: block;
  margin-bottom: 24px;
}
.title {
  font-size: 24px;
  line-height: 1.4;
  margin-bottom: 10px;
}
.meta {
  font-size: 13px;
  color: var(--color-text-light);
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--color-border);
}
.cat-badge {
  display: inline-block;
  background: var(--color-primary);
  color: #fff;
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 999px;
  margin-right: 6px;
}
.like-row {
  display: flex;
  justify-content: center;
  margin-bottom: 24px;
}
.sel-comment-btn {
  position: fixed;
  z-index: 60;
  padding: 5px 14px;
  border: none;
  border-radius: 999px;
  background: var(--color-primary);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  box-shadow: var(--shadow);
}
.sel-comment-btn:hover {
  background: var(--color-primary-dark);
}
.quote-form {
  position: fixed;
  z-index: 60;
  width: 260px;
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.qf-quote {
  font-size: 12px;
  color: var(--color-text-light);
  border-left: 3px solid var(--color-primary);
  padding-left: 8px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.quote-form input,
.quote-form textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  outline: none;
  font: inherit;
  font-size: 13px;
  resize: vertical;
}
.quote-form input:focus,
.quote-form textarea:focus {
  border-color: var(--color-primary);
}
.qf-error {
  color: #c0392b;
  font-size: 12px;
}
.qf-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.qf-cancel,
.qf-submit {
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}
.qf-cancel {
  border: 1px solid var(--color-border);
  background: #fff;
}
.qf-submit {
  border: none;
  background: var(--color-primary);
  color: #fff;
}
.qf-submit:hover:not(:disabled) {
  background: var(--color-primary-dark);
}
.qf-submit:disabled {
  opacity: 0.6;
  cursor: default;
}
.quote-notice {
  position: fixed;
  left: 50%;
  bottom: 32px;
  transform: translateX(-50%);
  z-index: 60;
  background: var(--color-primary);
  color: #fff;
  font-size: 13px;
  padding: 8px 20px;
  border-radius: 999px;
  box-shadow: var(--shadow);
}
.quote-popover {
  position: fixed;
  z-index: 60;
  width: 280px;
  max-height: 240px;
  overflow-y: auto;
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 14px;
}
.qp-quote {
  font-size: 12px;
  color: var(--color-text-light);
  border-left: 3px solid var(--color-primary);
  padding-left: 8px;
  margin-bottom: 10px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.qp-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.qp-item {
  border-top: 1px solid var(--color-border);
  padding-top: 8px;
  font-size: 13px;
}
.qp-item:first-child {
  border-top: none;
  padding-top: 0;
}
.qp-nick {
  color: var(--color-primary);
  font-weight: 600;
  margin-right: 6px;
}
.qp-text {
  white-space: pre-wrap;
  word-break: break-word;
}
.qp-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}
.qp-reply-btn {
  padding: 2px 8px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-card);
  color: var(--color-text-light);
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
}
.qp-reply-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.qp-reply-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}
.qp-reply-form input,
.qp-reply-form textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  outline: none;
  font: inherit;
  font-size: 12px;
  resize: vertical;
}
.qp-reply-form input:focus,
.qp-reply-form textarea:focus {
  border-color: var(--color-primary);
}
.qp-reply-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
  padding-left: 10px;
  border-left: 2px solid var(--color-border);
}
@media (max-width: 480px) {
  .article {
    padding: 20px 18px;
  }
}
</style>

<style>
/* 高亮 mark 由 JS 动态创建，拿不到 scoped 属性，需全局样式 */
mark.quote-mark {
  background: color-mix(in srgb, var(--color-primary) 22%, transparent);
  color: inherit;
  border-bottom: 1px solid var(--color-primary);
  border-radius: 2px;
  padding: 0 1px;
  cursor: pointer;
}
mark.quote-mark:hover {
  background: color-mix(in srgb, var(--color-primary) 35%, transparent);
}
</style>
