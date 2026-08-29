<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { unreadCount, unreadItems, hasNotificationToken, loadUnread, markRead, notificationText, notificationLink } from '../notifications';

const router = useRouter();
const visible = ref(false);

// 进入小站有未读则弹窗列出摘要；本次会话只弹一次
onMounted(async () => {
  if (!hasNotificationToken()) return;
  if (sessionStorage.getItem('notif_popup_shown')) return;
  await loadUnread();
  if (unreadCount.value > 0) {
    visible.value = true;
    sessionStorage.setItem('notif_popup_shown', '1');
  }
});

function close() {
  visible.value = false;
}

async function go(n) {
  close();
  await markRead([n.id]);
  router.push(notificationLink(n));
}
</script>

<template>
  <div v-if="visible" class="modal" @click.self="close">
    <div class="card">
      <h3 class="title">你有 {{ unreadCount }} 条新消息</h3>
      <div class="list">
        <div v-for="n in unreadItems" :key="n.id" class="item" @click="go(n)">
          {{ notificationText(n) }}
        </div>
      </div>
      <button class="ok" @click="close">知道了</button>
    </div>
  </div>
</template>

<style scoped>
.modal {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.card {
  background: #fff;
  border-radius: 14px;
  width: 100%;
  max-width: 340px;
  padding: 18px;
}
.title {
  margin: 0 0 10px;
  font-size: 16px;
}
.list {
  max-height: 280px;
  overflow-y: auto;
}
.item {
  padding: 8px 6px;
  font-size: 14px;
  line-height: 1.5;
  border-bottom: 1px solid var(--color-border);
  cursor: pointer;
  word-break: break-all;
}
.item:last-child {
  border-bottom: none;
}
.ok {
  margin-top: 12px;
  width: 100%;
  border: none;
  border-radius: 999px;
  background: var(--color-primary);
  color: #fff;
  padding: 9px;
  font-size: 14px;
  cursor: pointer;
}
</style>
