import { createI18n } from 'vue-i18n';
import zh from './zh.js';
import en from './en.js';

export const DEFAULT_LOCALE = 'en';
export const LOCALES = ['zh', 'en'];

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: DEFAULT_LOCALE,
  fallbackLocale: 'zh',
  messages: { zh, en },
});

// 给内部路径加当前语言前缀；已带语言前缀时幂等。
// 例：localize('/albums') -> '/en/albums'；localize('/en/albums') -> '/en/albums'
export function localize(path = '/') {
  const lang = i18n.global.locale.value || DEFAULT_LOCALE;
  const [pathname = '', query = ''] = String(path).split('?');
  const qs = query ? '?' + query : '';
  if (pathname === '') return '/' + lang + qs;
  const first = pathname.split('/')[1];
  if (first === lang) return pathname + qs;
  if (LOCALES.includes(first)) {
    const rest = pathname.slice(first.length + 1);
    const joined = '/' + lang + (rest === '' ? '' : '/' + rest);
    return joined + qs;
  }
  const joined = pathname === '/' ? `/${lang}` : `/${lang}${pathname}`;
  return joined + qs;
}
