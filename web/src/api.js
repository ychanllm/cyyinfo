import { i18n } from './i18n';

const GUEST_KEY = 'cyyinfo_guest_token';
const ADMIN_KEY = 'cyyinfo_admin_token';
const USER_KEY = 'cyyinfo_user_token';

export const getGuestToken = () => localStorage.getItem(GUEST_KEY) || '';
export const setGuestToken = (t) => localStorage.setItem(GUEST_KEY, t);
export const clearGuestToken = () => localStorage.removeItem(GUEST_KEY);
export const getAdminToken = () => localStorage.getItem(ADMIN_KEY) || '';
export const setAdminToken = (t) => localStorage.setItem(ADMIN_KEY, t);
export const clearAdminToken = () => localStorage.removeItem(ADMIN_KEY);
export const getUserToken = () => localStorage.getItem(USER_KEY) || '';
export const setUserToken = (t) => localStorage.setItem(USER_KEY, t);
export const clearUserToken = () => localStorage.removeItem(USER_KEY);

async function request(path, { method = 'GET', body, admin = false, form = null } = {}) {
  const headers = {};
  // 用户接口优先发用户 token：浏览器同时存有管理员 token 时，避免用户请求被当成管理员（401 错跳管理员登录）；
  // 管理员无用户 token 时回退管理员 token（可免口令浏览公开页、点赞记到归属用户）；最后访客口令 token
  const userToken = getUserToken();
  const adminToken = getAdminToken();
  const token = admin ? adminToken : (userToken || adminToken || getGuestToken());
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  // 公开内容接口按站点语言（锁定中文）取本地化内容（后台接口返回中英两版，无需 lang）
  let url = path;
  if (!admin && method === 'GET') {
    url += (url.includes('?') ? '&' : '?') + 'lang=zh';
  }
  const res = await fetch(url, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    if (path.endsWith('/admin/login') || path.endsWith('/auth/login')) {
      // 登录接口 401 = 账号或密码错误：留在登录页提示，不跳转到门禁页
      throw new Error(data.detail || i18n.global.t('api.badCredentials'));
    }
    // 按本次请求实际发送的 token 分流：发了管理员 token 才按管理员会话失效处理，
    // 否则按用户/访客处理（浏览器里有管理员 token 不代表这次请求用的是它）
    if (admin || (!userToken && adminToken)) {
      // 管理员会话失效：清管理员 token，回管理员登录页（已登录管理员不应被抛到访客门禁页）
      clearAdminToken();
      if (!location.pathname.startsWith('/admin/login')) location.href = '/admin/login';
    } else {
      // 访客/用户会话失效：清 token；登录用户回登录页（带上回跳地址），纯访客回门禁页
      const hadUserToken = Boolean(getUserToken());
      clearGuestToken();
      clearUserToken();
      if (hadUserToken) {
        if (!location.pathname.startsWith('/login')) {
          location.href = `/login?redirect=${encodeURIComponent(location.pathname)}`;
        }
      } else if (!location.pathname.startsWith('/gate')) {
        location.href = '/gate';
      }
    }
    throw new Error(data.detail || i18n.global.t('api.unauthorized'));
  }
  if (!res.ok) throw new Error(data.detail || i18n.global.t('api.requestFailed', { status: res.status }));
  return data;
}

export const api = (path, opts) => request(`/api${path}`, opts);
export const apiUpload = (path, formData, admin = true) =>
  request(`/api${path}`, { method: 'POST', form: formData, admin });
