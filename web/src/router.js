import { createRouter, createWebHistory } from 'vue-router';
import { api, getGuestToken, getAdminToken } from './api';

const routes = [
  { path: '/gate', name: 'gate', component: () => import('./views/GateView.vue'), meta: { public: true } },
  { path: '/', name: 'home', component: () => import('./views/HomeView.vue') },
  { path: '/admin/login', name: 'admin-login', component: () => import('./views/admin/LoginView.vue'), meta: { public: true } },
];

export const router = createRouter({ history: createWebHistory(), routes });

let passcodeEnabled = null; // 缓存 site/status

router.beforeEach(async (to) => {
  if (to.meta.public) return true;
  // 后台守卫
  if (to.path.startsWith('/admin')) {
    return getAdminToken() ? true : { name: 'admin-login' };
  }
  // 访客口令守卫
  if (passcodeEnabled === null) {
    try {
      const s = await api('/site/status');
      passcodeEnabled = s.passcode_enabled;
    } catch { passcodeEnabled = false; }
  }
  if (passcodeEnabled && !getGuestToken()) return { name: 'gate' };
  return true;
});
