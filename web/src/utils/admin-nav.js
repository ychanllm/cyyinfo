import { ref } from 'vue';
import { api } from '../api';

// 后台左侧菜单的默认顺序;key 稳定不变,排序设置存的是 key 数组
export const DEFAULT_NAV = [
  { key: 'stats', path: '/admin/stats', labelKey: 'admin.stats' },
  { key: 'media', path: '/admin/media', labelKey: 'admin.media' },
  { key: 'dishes', path: '/admin/dishes', labelKey: 'admin.dishes' },
  { key: 'stores', path: '/admin/stores', labelKey: 'admin.stores' },
  { key: 'messages', path: '/admin/messages', labelKey: 'admin.messages' },
  { key: 'prizes', path: '/admin/prizes', labelKey: 'admin.prizes' },
  { key: 'prize-records', path: '/admin/prize-records', labelKey: 'admin.prizeRecords' },
  { key: 'users', path: '/admin/users', labelKey: 'admin.users' },
  { key: 'changelog', path: '/admin/changelog', labelKey: 'admin.changelog' },
  { key: 'settings', path: '/admin/settings', labelKey: 'admin.settings' },
];

// null = 使用默认顺序(未设置或加载失败)
export const navOrder = ref(null);

// 按已存顺序重排:未知 key 忽略,顺序里缺失的项追加到末尾
export function applyNavOrder(order) {
  if (!Array.isArray(order)) return DEFAULT_NAV;
  const known = new Map(DEFAULT_NAV.map((item) => [item.key, item]));
  const picked = [];
  for (const key of order) {
    const item = known.get(key);
    if (item && !picked.includes(item)) picked.push(item);
  }
  for (const item of DEFAULT_NAV) {
    if (!picked.includes(item)) picked.push(item);
  }
  return picked;
}

export async function loadNavOrder() {
  try {
    const data = await api('/admin/settings', { admin: true });
    navOrder.value = data.admin_nav_order ? JSON.parse(data.admin_nav_order) : null;
  } catch {
    navOrder.value = null;
  }
}
