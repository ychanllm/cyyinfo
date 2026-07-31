// 桌宠适配层：从 Electron 版 renderer.js 移植为纯 Web 版本
// 数据驱动自 skin.json：cell {w,h}、actions {row,durs,loop?,label?,lines?}、
// behaviors.ambient（动作名数组，待机轮换池）、events（分类台词池）
// 与 Electron 版的差异：
//   - window.petAPI.invoke('skin-current') → createPet(canvas, bubbleEl, skinUrl) 参数 + fetch
//   - window.petAPI.onPet(...) → 返回对象的 play()/say() 方法
//   - 'once-done'/'drag-begin' 等 IPC → 内部状态（once 播完自动回待机）
//   - 气泡显隐由 display 改为 opacity（配合 CSS transition），样式由组件负责
//   - 爱心粒子（spawnHearts）属亲密度玩法，按 YAGNI 未移植

export async function createPet(canvas, bubbleEl, skinUrl) {
  const skin = await (await fetch(skinUrl)).json();
  const base = skinUrl.slice(0, skinUrl.lastIndexOf('/') + 1);
  const img = new Image();
  img.src = base + (skin.image ?? 'spritesheet.webp');
  await img.decode();

  const CELL_W = skin.cell.w;
  const CELL_H = skin.cell.h;
  canvas.width = CELL_W;
  canvas.height = CELL_H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  let destroyed = false;
  let frameTimer = null;
  let lineTimer = null;
  let ambientTimer = null;
  let busy = false; // 点播动作播放中，ambient 轮换不打断

  const defaultAction = skin.defaultAction ?? Object.keys(skin.actions)[0];
  const ambientPool = Array.isArray(skin.behaviors?.ambient)
    ? skin.behaviors.ambient.filter((n) => skin.actions[n])
    : [defaultAction];

  function drawFrame(row, idx) {
    ctx.clearRect(0, 0, CELL_W, CELL_H);
    ctx.drawImage(img, idx * CELL_W, row * CELL_H, CELL_W, CELL_H, 0, 0, CELL_W, CELL_H);
  }

  // 与 renderer.js 的 setState/step 同语义：once（或动作本身非 loop）播完一轮后回调
  function playRow(name, { once = false, onDone } = {}) {
    const spec = skin.actions[name];
    if (!spec) return;
    clearTimeout(frameTimer);
    const playOnce = once || !spec.loop;
    let idx = 0;
    drawFrame(spec.row, 0);
    (function step() {
      frameTimer = setTimeout(() => {
        if (destroyed) return;
        idx++;
        if (idx >= spec.durs.length) {
          if (playOnce) { onDone?.(); return; }
          idx = 0;
        }
        drawFrame(spec.row, idx);
        step();
      }, spec.durs[idx]);
    })();
  }

  function idle() {
    busy = false;
    playRow(defaultAction);
  }

  // 点播一个动作：once=true（默认）播完一轮后自动回待机；
  // once=false 且动作 loop=true 时持续循环，直到下次 play/空闲轮换打断
  function play(name, once = true) {
    const spec = skin.actions[name];
    if (!spec) return;
    busy = true;
    playRow(name, { once, onDone: idle });
    if (spec.lines?.length) {
      say(spec.lines[Math.floor(Math.random() * spec.lines.length)]);
    }
  }

  function say(text, msec = 3500) {
    if (!bubbleEl) return;
    bubbleEl.textContent = text;
    bubbleEl.style.opacity = '1';
    clearTimeout(lineTimer);
    lineTimer = setTimeout(() => { bubbleEl.style.opacity = '0'; }, msec);
  }

  // 随机台词（events 全池）+ 待机动作轮换（behaviors.ambient 池），每 30-60s
  const eventLines = Object.values(skin.events ?? {}).flat();
  (function ambient() {
    ambientTimer = setTimeout(() => {
      if (destroyed) return;
      if (eventLines.length && Math.random() < 0.6) {
        say(eventLines[Math.floor(Math.random() * eventLines.length)]);
      }
      if (!busy && ambientPool.length > 1 && Math.random() < 0.4) {
        playRow(ambientPool[Math.floor(Math.random() * ambientPool.length)]);
      }
      ambient();
    }, 30000 + Math.random() * 30000);
  })();

  idle();

  return {
    play,
    say,
    actionNames: Object.keys(skin.actions),
    defaultAction,
    destroy() {
      destroyed = true;
      clearTimeout(frameTimer);
      clearTimeout(lineTimer);
      clearTimeout(ambientTimer);
    },
  };
}
