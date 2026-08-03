<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../api';
import MessageBoard from '../components/MessageBoard.vue';

const status = ref({});
const diaries = ref([]);
const photo = ref(null);

const days = computed(() => {
  if (!status.value.anniversary_date) return null;
  const start = new Date(status.value.anniversary_date + 'T00:00:00');
  return Math.floor((Date.now() - start.getTime()) / 86400000) + 1;
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
      <template v-if="days !== null">
        <p class="hero-label">从 {{ status.anniversary_date }} 到现在</p>
        <h1 class="hero-title">我们在一起 <span class="num">{{ days }}</span> 天</h1>
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
