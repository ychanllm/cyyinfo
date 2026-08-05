import { createRouter, createWebHistory } from 'vue-router';
import { api, getGuestToken, getAdminToken } from './api';
import { i18n, DEFAULT_LOCALE, LOCALES } from './i18n';

const routes = [
  // 裸根路径：跳到默认语言
  { path: '/', redirect: () => `/${DEFAULT_LOCALE}` },
  { path: '/:lang/gate', name: 'gate', component: () => import('./views/GateView.vue'), meta: { public: true } },
  { path: '/:lang', name: 'home', component: () => import('./views/HomeView.vue') },
  { path: '/:lang/albums', name: 'albums', component: () => import('./views/AlbumsView.vue') },
  { path: '/:lang/albums/:id', name: 'album-detail', component: () => import('./views/AlbumDetailView.vue') },
  { path: '/:lang/diaries', name: 'diaries', component: () => import('./views/DiariesView.vue') },
  { path: '/:lang/diaries/:slugOrId', name: 'diary-detail', component: () => import('./views/DiaryDetailView.vue') },
  { path: '/:lang/music', name: 'music', component: () => import('./views/MusicView.vue') },
  { path: '/:lang/music/:id', name: 'music-album', component: () => import('./views/MusicAlbumView.vue') },
  {
    path: '/:lang/admin/login',
    name: 'admin-login',
    component: () => import('./views/admin/LoginView.vue'),
    meta: { public: true, admin: true },
  },
  {
    path: '/:lang/admin',
    component: () => import('./views/admin/AdminLayout.vue'),
    meta: { admin: true },
    children: [
      { path: '', redirect: (to) => `/${to.params.lang}/admin/photos` },
      { path: 'photos', name: 'admin-photos', component: () => import('./views/admin/PhotosView.vue') },
      { path: 'diaries', name: 'admin-diaries', component: () => import('./views/admin/DiariesView.vue') },
      { path: 'diaries/new', name: 'admin-diary-new', component: () => import('./views/admin/DiaryEditView.vue') },
      { path: 'diaries/:id/edit', name: 'admin-diary-edit', component: () => import('./views/admin/DiaryEditView.vue') },
      { path: 'diary-categories', name: 'admin-diary-categories', component: () => import('./views/admin/DiaryCategoriesView.vue') },
      { path: 'music', name: 'admin-music', component: () => import('./views/admin/MusicView.vue') },
      { path: 'reminders', name: 'admin-reminders', component: () => import('./views/admin/RemindersView.vue') },
      { path: 'messages', name: 'admin-messages', component: () => import('./views/admin/MessagesView.vue') },
      { path: 'users', name: 'admin-users', component: () => import('./views/admin/UsersView.vue') },
      { path: 'settings', name: 'admin-settings', component: () => import('./views/admin/SettingsView.vue') },
    ],
  },
  // 未知路径兜底：经由裸根路径跳默认语言
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({ history: createWebHistory(), routes });

let passcodeEnabled = null; // 缓存 site/status

router.beforeEach(async (to) => {
  const lang = to.params.lang;
  if (!lang) {
    const rest = to.path === '/' ? '' : to.path;
    return { path: `/${DEFAULT_LOCALE}${rest}` };
  }
  if (!LOCALES.includes(lang)) {
    const rest = to.path.replace(new RegExp(`^/${lang}`), '');
    return { path: `/${DEFAULT_LOCALE}${rest}` };
  }
  i18n.global.locale.value = lang;
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.title = i18n.global.t('site.title');

  if (to.meta.public) return true;
  // 后台守卫
  if (to.meta.admin) {
    return getAdminToken() ? true : { name: 'admin-login', params: { lang }, query: { redirect: to.fullPath } };
  }
  // 访客口令守卫：已登录管理员可免口令浏览公开页
  if (passcodeEnabled === null) {
    try {
      const s = await api('/site/status');
      passcodeEnabled = s.passcode_enabled;
    } catch { passcodeEnabled = false; }
  }
  if (passcodeEnabled && !getGuestToken() && !getAdminToken()) {
    return { name: 'gate', params: { lang }, query: { redirect: to.fullPath } };
  }
  return true;
});
