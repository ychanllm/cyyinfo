<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../api';
import MessageBoard from '../components/MessageBoard.vue';

const status = ref({});
const diaries = ref([]);
const photo = ref(null);

// 纪念日距今的天数差（负数=还没到，正数=已在一起 N 天）
const diffDays = computed(() => {
  if (!status.value.anniversary_date) return null;
  const start = new Date(status.value.anniversary_date + 'T00:00:00');
  if (Number.isNaN(start.getTime())) return null;
  return Math.floor((Date.now() - start.getTime()) / 86400000);
});

// 首页标签：后台「设置」可自定义（{date} 会被替换成纪念日日期），留空自动生成
const heroLabelText = computed(() => {
  const date = status.value.anniversary_date || '';
  const custom = status.value.hero_label;
  if (custom) return custom.replace(/\{date\}/g, date);
  if (diffDays.value === null) return '';
  return diffDays.value >= 0 ? `从 ${date} 到现在` : `距离 ${date}`;
});

// 首页标题天数（正数=在一起天数，负数=距纪念日天数）
const heroDaysText = computed(() => {
  if (diffDays.value === null) return '';
  return diffDays.value >= 0 ? diffDays.value + 1 : -diffDays.value;
});

// 自定义标题文案（{days} 会被替换成天数），设置后使用
const heroTitleText = computed(() => {
  const custom = status.value.hero_title;
  const d = String(heroDaysText.value);
  if (custom) return custom.replace(/\{days\}/g, d);
  return diffDays.value !== null && diffDays.value >= 0 ? `我们在一起 ${d} 天` : `还有 ${d} 天到纪念日`;
});

function fmtDate(s) {
  return String(s || '').slice(0, 10);
}

onMounted(async () => {
  try {
    status.value = await api('/site/status');
  } catch { /* 保持默认 */ }
  try {
    const d = await api('/diaries?page=1');
    diaries.value = (d.items || []).slice(0, 3);
  } catch { /* 保持默认 */ }
  try {
    const albums = await api('/albums');
    const withCover = (albums || []).filter((a) => a.cover_filename);
    if (withCover.length) {
      photo.value = withCover[Math.floor(Math.random() * withCover.length)];
    }
  } catch { /* 保持默认 */ }
});
</script>

<template>
  <div class="home">
    <section class="hero">
      <template v-if="diffDays !== null">
        <p class="hero-label">{{ heroLabelText }}</p>
        <h1 v-if="status.hero_title" class="hero-title">{{ heroTitleText }}</h1>
        <h1 v-else-if="diffDays >= 0" class="hero-title">我们在一起 <span class="num">{{ diffDays + 1 }}</span> 天</h1>
        <h1 v-else class="hero-title">还有 <span class="num">{{ -diffDays }}</span> 天到纪念日</h1>
      </template>
      <h1 v-else class="hero-title">欢迎来到{{ status.site_name || '我们的小站' }}</h1>
    </section>

    <div class="grid">
      <section class="card diaries">
        <h2 class="card-title">最新日记</h2>
        <ul v-if="diaries.length" class="diary-list">
          <li v-for="d in diaries" :key="d.id">
            <router-link :to="`/diaries/${d.slug || d.id}`" class="diary">
              <h3 class="diary-title">{{ d.title }}</h3>
              <p class="diary-excerpt">{{ d.excerpt }}</p>
              <p class="diary-date">{{ fmtDate(d.published_at) }}</p>
            </router-link>
          </li>
        </ul>
        <p v-else class="empty">还没有日记，敬请期待</p>
      </section>

      <section v-if="photo" class="card photo-card">
        <h2 class="card-title">随手一拍</h2>
        <router-link to="/albums" class="polaroid photo-link">
          <span class="tape peach"></span>
          <img :src="`/uploads/${photo.cover_filename}`" :alt="photo.title" class="photo" />
          <p class="photo-title font-hand">{{ photo.title }}</p>
        </router-link>
      </section>
    </div>

    <MessageBoard targetType="site" :targetId="null" />
  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.hero {
  text-align: center;
  padding: 48px 0 24px;
}
.hero-label {
  color: var(--color-text-light);
  font-size: 14px;
  margin-bottom: 8px;
}
.hero-title {
  font-family: var(--font-title);
  font-size: 34px;
  font-weight: 400;
  color: var(--color-text);
}
.num {
  color: var(--color-primary);
  font-size: 44px;
  margin: 0 4px;
}
.grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 24px;
}
@media (max-width: 720px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
.card {
  background: var(--color-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 24px;
}
.card-title {
  font-size: 18px;
  color: var(--color-primary);
  margin-bottom: 16px;
}
.diary-list {
  list-style: none;
  display: flex;
  flex-direction: column;
}
.diary {
  display: block;
  padding: 12px 8px;
  border-radius: 8px;
  color: var(--color-text);
}
.diary:hover {
  background: var(--bg-deep);
}
.diary-list li + li {
  border-top: 1px solid var(--color-border);
}
.diary-title {
  font-size: 16px;
  margin-bottom: 4px;
}
.diary-excerpt {
  font-size: 14px;
  color: var(--color-text-light);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 4px;
}
.diary-date {
  font-size: 12px;
  color: var(--color-text-light);
}
.empty {
  color: var(--color-text-light);
  font-size: 14px;
  text-align: center;
  padding: 16px 0;
}
.photo-link {
  display: block;
  margin-top: 8px;
}
.photo {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  display: block;
  border-radius: 4px;
}
.photo-title {
  margin-top: 8px;
  font-size: 17px;
  color: var(--color-text-light);
  text-align: center;
}
</style>
