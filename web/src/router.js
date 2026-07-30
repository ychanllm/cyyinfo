import { createRouter, createWebHistory } from 'vue-router';
import { api, getGuestToken, getAdminToken } from './api';

const routes = [
  { path: '/gate', name: 'gate', component: () => import('./views/GateView.vue'), meta: { public: true } },
  { path: '/', name: 'home', component: () => import('./views/HomeView.vue') },
  { path: '/albums', name: 'albums', component: () => import('./views/AlbumsView.vue') },
  { path: '/albums/:id', name: 'album-detail', component: () => import('./views/AlbumDetailView.vue') },
  { path: '/diaries', name: 'diaries', component: () => import('./views/DiariesView.vue') },
  { path: '/diaries/:slugOrId', name: 'diary-detail', component: () => import('./views/DiaryDetailView.vue') },
  { path: '/music', name: 'music', component: () => import('./views/MusicView.vue') },
  { path: '/music/:id', name: 'music-album', component: () => import('./views/MusicAlbumView.vue') },
  { path: '/admin/login', name: 'admin-login', component: () => import('./views/admin/LoginView.vue'), meta: { public: true } },
  {
    path: '/admin',
    component: () => import('./views/admin/AdminLayout.vue'),
    children: [
      { path: '', redirect: '/admin/photos' },
      { path: 'photos', name: 'admin-photos', component: () => import('./views/admin/PhotosView.vue') },
      { path: 'diaries', name: 'admin-diaries', component: () => import('./views/admin/DiariesView.vue') },
      { path: 'diaries/new', name: 'admin-diary-new', component: () => import('./views/admin/DiaryEditView.vue') },
      { path: 'diaries/:id/edit', name: 'admin-diary-edit', component: () => import('./views/admin/DiaryEditView.vue') },
      { path: 'music', name: 'admin-music', component: () => import('./views/admin/MusicView.vue') },
      { path: 'messages', name: 'admin-messages', component: () => import('./views/admin/MessagesView.vue') },
      { path: 'users', name: 'admin-users', component: () => import('./views/admin/UsersView.vue') },
      { path: 'settings', name: 'admin-settings', component: () => import('./views/admin/SettingsView.vue') },
    ],
  },
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
