import { i18n } from '../i18n';

// 按当前语言输出长日期：zh -> 2026年3月5日，en -> March 5, 2026
export function fmtDateFull(s) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s || '').slice(0, 10);
  const loc = i18n.global.locale.value === 'zh' ? 'zh-CN' : 'en-US';
  return new Intl.DateTimeFormat(loc, { year: 'numeric', month: 'long', day: 'numeric' }).format(d);
}
