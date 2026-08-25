import { createRouter, createWebHistory } from 'vue-router';
import { api, getGuestToken, getAdminToken, getUserToken } from './api';
import { i18n } from './i18n';
import { loadSiteStatus } from './site-status';

const routes = [
  { path: '/', name: 'home', component: () => import('./views/HomeView.vue') },
  { path: '/gate', name: 'gate', component: () => import('./views/GateView.vue'), meta: { public: true } },
  { path: '/login', name: 'login', component: () => import('./views/UserLoginView.vue'), meta: { public: true } },
  { path: '/albums', name: 'albums', component: () => import('./views/AlbumsView.vue') },
  { path: '/albums/:id', name: 'album-detail', component: () => import('./views/AlbumDetailView.vue') },
  { path: '/diaries', name: 'diaries', component: () => import('./views/DiariesView.vue') },
  { path: '/diaries/:slugOrId', name: 'diary-detail', component: () => import('./views/DiaryDetailView.vue') },
  { path: '/leaderboard', name: 'leaderboard', component: () => import('./views/LeaderboardView.vue') },
  { path: '/music', name: 'music', component: () => import('./views/MusicView.vue') },
  { path: '/music/:id', name: 'music-album', component: () => import('./views/MusicAlbumView.vue') },
  { path: '/points', name: 'points', component: () => import('./views/PointsView.vue'), meta: { user: true } },
  { path: '/food', name: 'food', component: () => import('./views/FoodView.vue') },
  { path: '/dishes', redirect: '/food?tab=dishes' },
  { path: '/stores', redirect: '/food?tab=stores' },
  {
    path: '/admin/login',
    name: 'admin-login',
    component: () => import('./views/admin/LoginView.vue'),
    meta: { public: true, admin: true },
  },
  {
    path: '/admin',
    component: () => import('./views/admin/AdminLayout.vue'),
    meta: { admin: true },
    children: [
      { path: '', redirect: '/admin/media' },
      { path: 'stats', name: 'admin-stats', component: () => import('./views/admin/StatsView.vue') },
      { path: 'media', name: 'admin-media', component: () => import('./views/admin/MediaView.vue') },
      { path: 'photos', redirect: '/admin/media?tab=photos' },
      { path: 'diaries', redirect: '/admin/media?tab=diaries' },
      { path: 'diaries/new', name: 'admin-diary-new', component: () => import('./views/admin/DiaryEditView.vue') },
      { path: 'diaries/:id/edit', name: 'admin-diary-edit', component: () => import('./views/admin/DiaryEditView.vue') },
      { path: 'music', redirect: '/admin/media?tab=music' },
      { path: 'food', name: 'admin-food', component: () => import('./views/admin/FoodView.vue') },
      { path: 'dishes', redirect: '/admin/food?tab=dishes' },
      { path: 'stores', redirect: '/admin/food?tab=stores' },
      { path: 'messages', name: 'admin-messages', component: () => import('./views/admin/MessagesView.vue') },
      { path: 'users', name: 'admin-users', component: () => import('./views/admin/UsersView.vue') },
      { path: 'settings', name: 'admin-settings', component: () => import('./views/admin/SettingsView.vue') },
      { path: 'prizes', name: 'admin-prizes', component: () => import('./views/admin/AdminPrizesView.vue') },
      { path: 'prize-records', name: 'admin-prize-records', component: () => import('./views/admin/AdminPrizeRecordsView.vue') },
      { path: 'changelog', name: 'admin-changelog', component: () => import('./views/admin/ChangelogView.vue') },
    ],
  },
  // 旧链接兼容：/zh/* 与 /en/* 重定向到无前缀路径（保留 path 剩余部分和 query）
  {
    path: '/:lang(zh|en)/:pathMatch(.*)*',
    redirect: (to) => {
      const rest = [].concat(to.params.pathMatch).join('/');
      return { path: '/' + rest, query: to.query };
    },
  },
  // 未知路径兜底：回首页
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

// 记录各路径离开时的滚动位置：详情页内「返回」是 push 导航（无 savedPosition），
// 浏览器前进/后退则直接用 savedPosition
const scrollPositions = new Map();

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    scrollPositions.set(from.fullPath, window.scrollY);
    if (savedPosition) return savedPosition;
    const y = scrollPositions.get(to.fullPath);
    return y ? { top: y } : { top: 0 };
  },
});

let passcodeEnabled = null; // 缓存 site/status

router.beforeEach(async (to) => {
  document.documentElement.lang = 'zh-CN';
  document.title = i18n.global.t('site.title');

  if (to.meta.public) return true;
  // 积分/签到页需要用户登录
  if (to.meta.user && !getUserToken()) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  // 后台守卫
  if (to.meta.admin) {
    return getAdminToken() ? true : { name: 'admin-login', query: { redirect: to.fullPath } };
  }
  // 访客口令守卫：已登录管理员可免口令浏览公开页
  if (passcodeEnabled === null) {
    try {
      const s = await loadSiteStatus();
      passcodeEnabled = s.passcode_enabled;
    } catch { passcodeEnabled = false; }
  }
  if (passcodeEnabled && !getGuestToken() && !getAdminToken() && !getUserToken()) {
    return { name: 'gate', query: { redirect: to.fullPath } };
  }
  return true;
});
