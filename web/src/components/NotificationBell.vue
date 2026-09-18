<script setup>
import { ref, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { unreadCount, unreadItems, hasNotificationToken, loadUnread, markRead, notificationText, notificationLink } from '../notifications';

const route = useRoute();
const router = useRouter();
const open = ref(false);

onMounted(() => { if (hasNotificationToken()) loadUnread(); });
// 路由切换时刷新一次（评论后跳回列表等场景红点能及时出现）
watch(() => route.fullPath, () => { if (hasNotificationToken()) loadUnread(); });

async function go(n) {
  open.value = false;
  await markRead([n.id]);
  const link = notificationLink(n);
  if (link) router.push(link);
}

async function readAll() {
  open.value = false;
  await markRead();
}
</script>

<template>
  <div v-if="unreadCount > 0" class="bell">
    <button class="dot" aria-label="有新消息" @click="open = !open"></button>
    <div v-if="open" class="dropdown">
      <div v-for="n in unreadItems" :key="n.id" class="item" @click="go(n)">
        {{ notificationText(n) }}
      </div>
      <button class="read-all" @click="readAll">全部已读</button>
    </div>
  </div>
</template>

<style scoped>
.bell {
  position: relative;
  display: flex;
}
.dot {
  width: 10px;
  height: 10px;
  border: none;
  border-radius: 50%;
  background: #e0483e;
  cursor: pointer;
  padding: 0;
}
.dropdown {
  position: absolute;
  top: 20px;
  right: 0;
  width: 240px;
  max-height: 320px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
  z-index: 60;
  padding: 6px;
}
.item {
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.5;
  border-radius: 6px;
  cursor: pointer;
  word-break: break-all;
}
.item:hover {
  background: var(--bg-deep);
}
.read-all {
  display: block;
  width: 100%;
  border: none;
  background: none;
  padding: 8px;
  font-size: 13px;
  color: var(--color-primary);
  cursor: pointer;
}
</style>
