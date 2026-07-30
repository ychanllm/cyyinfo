// Task 12 桌宠结构性校验：验证 pet-adapter.js 对 skin.json 的字段假设
// 用法: node scripts/validate-pet-skin.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skinDir = join(root, 'public/pet/skins/default');
const skin = JSON.parse(readFileSync(join(skinDir, 'skin.json'), 'utf8'));

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

// --- webp 尺寸探测（RIFF/VP8X/VP8/VP8L）---
function webpSize(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('not a webp file');
  }
  const fourcc = buf.toString('ascii', 12, 16);
  if (fourcc === 'VP8X') {
    return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
  }
  if (fourcc === 'VP8 ') {
    return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  }
  if (fourcc === 'VP8L') {
    const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
    return {
      w: 1 + (((b1 & 0x3f) << 8) | b0),
      h: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  throw new Error('unknown webp chunk: ' + fourcc);
}

const { w: imgW, h: imgH } = webpSize(readFileSync(join(skinDir, 'spritesheet.webp')));
console.log(`spritesheet: ${imgW}x${imgH}, cell: ${skin.cell.w}x${skin.cell.h}`);

// --- adapter 假设的字段 ---
ok(Number.isInteger(skin.cell?.w) && Number.isInteger(skin.cell?.h), 'cell 为 {w,h} 整数');
ok(typeof skin.image === 'string', 'spritesheet 文件名字段为 image');
ok(typeof skin.defaultAction === 'string' && skin.actions[skin.defaultAction], 'defaultAction 指向存在的动作');
ok(imgW % skin.cell.w === 0, `图集宽 ${imgW} 可被 cell.w ${skin.cell.w} 整除（${imgW / skin.cell.w} 列）`);
ok(imgH % skin.cell.h === 0, `图集高 ${imgH} 可被 cell.h ${skin.cell.h} 整除（${imgH / skin.cell.h} 行）`);

const rows = imgH / skin.cell.h;
const cols = imgW / skin.cell.w;
for (const [name, a] of Object.entries(skin.actions)) {
  ok(Number.isInteger(a.row) && a.row >= 0 && a.row < rows, `action "${name}" row=${a.row} 在图集行数 ${rows} 内`);
  ok(Array.isArray(a.durs) && a.durs.length > 0 && a.durs.every((d) => d > 0), `action "${name}" durs 非空且均为正数`);
  ok(a.durs.length <= cols, `action "${name}" 帧数 ${a.durs.length} 不超过图集列数 ${cols}`);
}

// behaviors 引用的动作都必须存在（string 或 string[]）
for (const [key, val] of Object.entries(skin.behaviors ?? {})) {
  for (const n of Array.isArray(val) ? val : [val]) {
    ok(!!skin.actions[n], `behaviors.${key} 引用的动作 "${n}" 存在`);
  }
}
ok(Array.isArray(skin.behaviors?.ambient), 'behaviors.ambient 为动作名数组（adapter 按数组处理）');

// events 为 字符串数组 的字典，且非空
const pools = Object.values(skin.events ?? {});
ok(pools.length > 0 && pools.every((p) => Array.isArray(p) && p.every((s) => typeof s === 'string')),
  'events 为 分类台词池（string[] 字典）');

console.log(failures ? `\n${failures} 项校验失败` : '\n全部校验通过');
process.exit(failures ? 1 : 0);
