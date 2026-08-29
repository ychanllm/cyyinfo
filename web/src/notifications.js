import { ref } from 'vue';
import { api, getUserToken, getAdminToken } from './api';
import { localize } from './i18n';

// 未读通知共享状态：NavBar 红点与进入弹窗共用同一份数据（各自触发请求，共享的是状态而非请求去重；沿用 me.js 的模块级 ref 模式）
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
  switch (n.type) {
    case 'reply':
      return `${n.actor_nickname} 回复了你的评论${excerpt}`;
    case 'comment':
      if (n.target_type === 'diary') return `${n.actor_nickname} 评论了你的日记${excerpt}`;
      return `${n.actor_nickname} 在${n.target_type === 'photo' ? '照片' : '留言板'}留了言，待审核`;
    case 'like':
      return `${n.actor_nickname} 赞了你的${n.detail || '内容'}`;
    case 'thread':
      return `${n.actor_nickname} 也评论了你参与的日记${excerpt}`;
    case 'prize':
      return n.detail || '你有一条奖品动态';
    default:
      return '你有一条新消息';
  }
}

// 通知点击的跳转目标
export function notificationLink(n) {
  // 站长的待审核评论通知 → 后台留言审核
  if (n.type === 'comment' && (n.target_type === 'photo' || n.target_type === 'site')) {
    return '/admin/messages';
  }
  if (n.target_type === 'diary' && n.target_id) return localize(`/diaries/${n.target_id}`);
  if (n.target_type === 'album' && n.target_id) return localize(`/albums/${n.target_id}`);
  if (n.target_type === 'points') return localize('/points');
  return localize('/');
}
