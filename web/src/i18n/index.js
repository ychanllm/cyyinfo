import { createI18n } from 'vue-i18n';
import zh from './zh.js';

// 站点锁定中文，不做浏览器语言探测/切换
export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: 'zh',
  fallbackLocale: 'zh',
  messages: { zh },
});

// 恒等函数：路径不再带语言前缀。保留导出，视图中的 localize(...) 调用无需改动。
export function localize(path = '/') {
  return path;
}
