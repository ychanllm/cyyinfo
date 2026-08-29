import { ref } from 'vue';
import { api, getUserToken, getAdminToken } from './api';

// 未读通知共享状态：NavBar 红点与进入弹窗共用，避免重复请求（沿用 me.js 的模块级 ref 模式）
export const unreadCount = ref(0);
export const unreadItems = ref([]);

// 只有登录用户或站长才有通知；游客不请求（避免 401 分流跳转）
export const hasNotificationToken = () => Boolean(getUserToken() || getAdminToken());

export async function loadUnread() {
  if (!hasNotificationToken()) {
    unreadCount.value = 0;
    unreadItems.value = [];
    return;
  }
  try {
    const data = await api('/notifications/unread');
    unreadCount.value = data.count || 0;
    unreadItems.value = data.items || [];
  } catch {
    unreadCount.value = 0;
    unreadItems.value = [];
  }
}

// ids 不传 = 全部已读；完成后刷新未读状态
export async function markRead(ids) {
  try {
    await api('/notifications/read', { method: 'POST', body: ids ? { ids } : {} });
  } finally {
    await loadUnread();
  }
}

export function notificationText(n) {
  const excerpt = n.excerpt ? `：${n.excerpt}` : '';
  return n.type === 'reply'
    ? `${n.actor_nickname} 回复了你的评论${excerpt}`
    : `${n.actor_nickname} 评论了你的日记${excerpt}`;
}
