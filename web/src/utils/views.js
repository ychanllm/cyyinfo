import { api } from '../api';

// 浏览上报：同一会话同一目标只报一次（sessionStorage 去重），失败静默
export function reportView(targetType, targetId) {
  const id = Number(targetId);
  if (!Number.isInteger(id) || id <= 0) return;
  const key = `viewed:${targetType}:${id}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch { /* sessionStorage 不可用时仍上报一次 */ }
  api('/views', { method: 'POST', body: { target_type: targetType, target_id: id } }).catch(() => {});
}
