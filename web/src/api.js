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
  // 公开请求没有访客 token 时回退用管理员 token（contentGuard 两者都接受）
  const token = admin ? getAdminToken() : (getGuestToken() || getAdminToken());
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(path, { method, headers, body: payload });
  if (res.status === 401) {
    if (admin) {
      clearAdminToken();
      if (!location.pathname.startsWith('/admin/login')) location.href = '/admin/login';
    } else if (!location.pathname.startsWith('/gate')) {
      clearGuestToken();
      location.href = '/gate';
    }
    throw new Error('未授权');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `请求失败（${res.status}）`);
  return data;
}

export const api = (path, opts) => request(`/api${path}`, opts);
export const apiUpload = (path, formData, admin = true) =>
  request(`/api${path}`, { method: 'POST', form: formData, admin });
