import { i18n } from './i18n';

const GUEST_KEY = 'cyyinfo_guest_token';
const ADMIN_KEY = 'cyyinfo_admin_token';

export const getGuestToken = () => localStorage.getItem(GUEST_KEY) || '';
export const setGuestToken = (t) => localStorage.setItem(GUEST_KEY, t);
export const clearGuestToken = () => localStorage.removeItem(GUEST_KEY);
export const getAdminToken = () => localStorage.getItem(ADMIN_KEY) || '';
export const setAdminToken = (t) => localStorage.setItem(ADMIN_KEY, t);
export const clearAdminToken = () => localStorage.removeItem(ADMIN_KEY);

async function request(path, { method = 'GET', body, admin = false, form = null } = {}) {
  const headers = {};
  // 优先用管理员 token（管理员可免口令浏览公开页）；避免残留的过期访客 token 顶掉有效管理员身份
  const token = admin ? getAdminToken() : (getAdminToken() || getGuestToken());
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  // 公开内容接口按当前语言取本地化内容（后台接口返回中英两版，无需 lang）
  let url = path;
  if (!admin && method === 'GET') {
    url += (url.includes('?') ? '&' : '?') + 'lang=' + encodeURIComponent(i18n.global.locale.value);
  }
  const res = await fetch(url, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    if (path.endsWith('/admin/login')) {
      // 登录接口 401 = 账号或密码错误：留在登录页提示，不跳转到门禁页
      throw new Error(data.detail || i18n.global.t('api.badCredentials'));
    }
    const loc = i18n.global.locale.value;
    if (admin || getAdminToken()) {
      // 管理员会话失效：清管理员 token，回管理员登录页（已登录管理员不应被抛到访客门禁页）
      clearAdminToken();
      if (!location.pathname.startsWith(`/${loc}/admin/login`)) location.href = `/${loc}/admin/login`;
    } else {
      // 访客会话失效：回门禁页
      clearGuestToken();
      if (!location.pathname.startsWith(`/${loc}/gate`)) location.href = `/${loc}/gate`;
    }
    throw new Error(data.detail || i18n.global.t('api.unauthorized'));
  }
  if (!res.ok) throw new Error(data.detail || i18n.global.t('api.requestFailed', { status: res.status }));
  return data;
}

export const api = (path, opts) => request(`/api${path}`, opts);
export const apiUpload = (path, formData, admin = true) =>
  request(`/api${path}`, { method: 'POST', form: formData, admin });
