// 校验所有视图里用到的 t('key') 都在 zh/en 目录中定义
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import zh from '../src/i18n/zh.js';
import en from '../src/i18n/en.js';

const root = join(import.meta.dirname, '..', 'src');

// 收集所有 .vue / .js 文件
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(vue|js)$/.test(name)) acc.push(p);
  }
  return acc;
}

// 展平目录为点分 key
function flatten(obj, prefix = '') {
  const out = new Set();
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') for (const x of flatten(v, full)) out.add(x);
    else out.add(full);
  }
  return out;
}

const zhKeys = flatten(zh);
const enKeys = flatten(en);

// 中文缺失 = fallback 失效；英文缺失 = 英文站显示中文
const missingZh = [], missingEn = [];
const files = walk(root);
for (const file of files) {
  const txt = readFileSync(file, 'utf8');
  // 负向断言：t( 前不能是标识符字符，避免把 closest('mark')、createElement('x') 误当 i18n 调用
  const re = /(?<![\w$])\$?t\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(txt))) {
    const key = m[1];
    if (!/^[a-zA-Z][a-zA-Z0-9.]+$/.test(key)) continue; // 过滤非 key（路径等）
    if (!zhKeys.has(key)) missingZh.push(`${file.replace(root, '')} : ${key}`);
    if (!enKeys.has(key)) missingEn.push(`${file.replace(root, '')} : ${key}`);
  }
}

console.log(`zh keys: ${zhKeys.size}, en keys: ${enKeys.size}`);
console.log(`\n缺失的中文 key（${missingZh.length}）:`);
for (const x of missingZh) console.log('  -', x);
console.log(`\n缺失的英文 key（${missingEn.length}）:`);
for (const x of missingEn) console.log('  -', x);

process.exit(missingZh.length || missingEn.length ? 1 : 0);
