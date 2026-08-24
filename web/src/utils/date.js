// 站点锁定中文：长日期输出形如 2026年3月5日
export function fmtDateFull(s) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s || '').slice(0, 10);
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(d);
}
