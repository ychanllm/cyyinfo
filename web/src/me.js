import { ref } from 'vue';
import { api, getUserToken } from './api';

// 当前登录用户的共享状态：NavBar 左上角头像等全局展示用
export const me = ref(null);

// 有用户 token 时拉取 /auth/me；无 token 或失败（含 401 失效）时置空，头像随之隐藏
export async function loadMe() {
  if (!getUserToken()) {
    me.value = null;
    return;
  }
  try {
    me.value = await api('/auth/me');
  } catch {
    me.value = null;
  }
}
