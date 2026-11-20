/**
 * 简单模式（等级提升不加速）验收：CDP 无头浏览器 + 真实 DOM 点击。
 *
 * 用法: node tools/verify_tetris_easy.mjs
 * 截图写到系统临时目录 tetris-easy-shots/；失败时 exit 1。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const ROOT = process.cwd();
const OUT = path.join(os.tmpdir(), 'tetris-easy-shots');
const PORT = 9720 + Math.floor(Math.random() * 150);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tetris-easy-'));
fs.mkdirSync(OUT, { recursive: true });
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-proxy-server', '--no-first-run', '--disable-extensions', `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, 'about:blank'], { stdio: 'ignore' });
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map(); ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } else if (m.method) { const list = this.handlers.get(m.method) || []; this.handlers.set(m.method, []); for (const f of list) f(m.params); } }); }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  once(method) { return new Promise((res) => { const l = this.handlers.get(method) || []; l.push(res); this.handlers.set(method, l); }); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + ' :: ' + JSON.stringify(extra)); } }

async function main() {
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) { try { ready = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch { } if (!ready) await sleep(250); }
  if (!ready) throw new Error('DevTools 未就绪');
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  const cdp = new CDP(ws);
  const errors = [];
  cdp.ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (m.params.exceptionDetails.text || ''));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
  });
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const evalIn = async (expr) => (await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  const viewport = async (w, h, mobile) => { await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile, screenWidth: w, screenHeight: h }); await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: !!mobile, maxTouchPoints: 5 }); await sleep(400); };
  const shot = async (name, w, h) => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } }); const p = path.join(OUT, name); fs.writeFileSync(p, Buffer.from(data, 'base64')); return p; };
  const url = 'file:///' + path.join(ROOT, 'docs/tetris.html').replace(/\\/g, '/');
  const load = async (suffix) => { const loaded = cdp.once('Page.loadEventFired'); await cdp.send('Page.navigate', { url: url + (suffix || '') }); await Promise.race([loaded, sleep(15000)]); await sleep(1200); };

  // 桌面初始
  await viewport(1500, 1000, false);
  await load();
  let s = await evalIn(`(() => {
    const btn = document.getElementById('easyBtn');
    const dbg = window.TetrisDebug;
    return {
      exists: !!btn, aria: btn.getAttribute('aria-pressed'), on: btn.classList.contains('is-on'),
      stored: localStorage.getItem('tetris-easy'), state: dbg && dbg.getState(),
      iv10off: dbg.intervalForLevel(10), iv1: dbg.intervalForLevel(1), iv20: dbg.intervalForLevel(20),
      overlayHint: document.getElementById('ovHint').textContent,
      btnRect: (() => { const r = btn.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })(),
      scrollH: document.documentElement.scrollHeight, innerH: window.innerHeight,
      scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
      hud: (() => { const r = document.querySelector('.hud').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; })()
    };
  })()`);
  ok('按钮存在', s.exists === true);
  ok('初始简单模式关闭', s.aria === 'false' && s.on === false && !s.state.easyMode);
  ok('普通模式 10 级间隔=170ms', s.iv10off === 170, s.iv10off);
  ok('普通模式 20 级间隔=80ms（下限）', s.iv20 === 80, s.iv20);
  ok('1 级基础间隔=800ms', s.iv1 === 800, s.iv1);
  ok('桌面无滚动', s.scrollH <= s.innerH + 2 && s.scrollW <= s.innerW + 2, s);
  ok('按钮尺寸 >= 24', s.btnRect.w >= 24 && s.btnRect.h >= 24, s.btnRect);

  // 点击开启
  await evalIn(`document.getElementById('easyBtn').click()`);
  await sleep(300);
  s = await evalIn(`(() => {
    const btn = document.getElementById('easyBtn');
    const dbg = window.TetrisDebug;
    return {
      aria: btn.getAttribute('aria-pressed'), on: btn.classList.contains('is-on'),
      stored: localStorage.getItem('tetris-easy'), easy: dbg.getState().easyMode,
      iv10: dbg.intervalForLevel(10), iv20: dbg.intervalForLevel(20),
      hint: document.getElementById('ovHint').textContent
    };
  })()`);
  ok('开启后 aria/样式/状态同步', s.aria === 'true' && s.on === true && s.easy === true);
  ok('开启后持久化 tetris-easy=1', s.stored === '1', s.stored);
  ok('简单模式 10 级仍 800ms', s.iv10 === 800, s.iv10);
  ok('简单模式 20 级仍 800ms', s.iv20 === 800, s.iv20);
  ok('开始界面提示简单模式', /简单模式/.test(s.hint), s.hint);
  const desktopShot = await shot('tetris-easy-desktop.png', 1500, 1000);

  // 开始游戏后切换
  await evalIn(`document.getElementById('startBtn').click()`);
  await sleep(800);
  s = await evalIn(`(() => ({ state: document.body.dataset.state, dbg: window.TetrisDebug.getState() }))()`);
  ok('开始游戏 running', s.state === 'running');
  ok('运行中 1 级间隔=800', s.dbg.dropInterval === 800, s.dbg);
  await evalIn(`document.getElementById('easyBtn').click()`);
  await sleep(200);
  s = await evalIn(`window.TetrisDebug.getState()`);
  ok('运行中关闭简单模式后仍按当前等级计算', s.easyMode === false && s.dropInterval === 800, s);
  await evalIn(`document.getElementById('easyBtn').click()`);
  await sleep(200);
  s = await evalIn(`window.TetrisDebug.getState()`);
  ok('再次开启后状态恢复', s.easyMode === true && s.dropInterval === 800, s);

  // 刷新后持久化
  await load();
  s = await evalIn(`(() => { const b = document.getElementById('easyBtn'); return { on: b.classList.contains('is-on'), aria: b.getAttribute('aria-pressed'), stored: localStorage.getItem('tetris-easy'), easy: window.TetrisDebug.getState().easyMode }; })()`);
  ok('刷新后简单模式保持开启', s.on === true && s.aria === 'true' && s.stored === '1' && s.easy === true, s);
  const desktopShot2 = await shot('tetris-easy-desktop-on.png', 1500, 1000);

  // 手机竖屏布局
  await viewport(390, 844, true);
  await load('?touch=1');
  s = await evalIn(`(() => {
    const btn = document.getElementById('easyBtn');
    const r = btn.getBoundingClientRect();
    const hud = document.querySelector('.hud').getBoundingClientRect();
    return { visible: getComputedStyle(btn).display !== 'none' && r.width > 0, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, hudRight: hud.right,
      scrollH: document.documentElement.scrollHeight, innerH: window.innerHeight,
      scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
      on: btn.classList.contains('is-on'), text: btn.innerText.trim() };
  })()`);
  ok('手机竖屏按钮可见', s.visible === true && s.on === true, s);
  ok('手机竖屏按钮未溢出', s.rect.x >= 0 && s.rect.x + s.rect.w <= s.innerW + 2 && s.rect.y >= 0, s);
  ok('手机竖屏无滚动', s.scrollH <= s.innerH + 2 && s.scrollW <= s.innerW + 2, s);
  const mobileShot = await shot('tetris-easy-mobile.png', 390, 844);

  // 横屏布局
  await viewport(844, 390, true);
  await load('?touch=1');
  s = await evalIn(`(() => {
    const btn = document.getElementById('easyBtn');
    const r = btn.getBoundingClientRect();
    return { visible: getComputedStyle(btn).display !== 'none' && r.width > 0, rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      scrollH: document.documentElement.scrollHeight, innerH: window.innerHeight,
      scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, scale: getComputedStyle(document.documentElement).getPropertyValue('--game-scale').trim() };
  })()`);
  ok('横屏按钮可见', s.visible === true, s);
  ok('横屏无滚动', s.scrollH <= s.innerH + 2 && s.scrollW <= s.innerW + 2, s);
  const landscapeShot = await shot('tetris-easy-landscape.png', 844, 390);

  ok('无页面异常', errors.filter(e => !/NotAllowedError|播放失败/.test(e)).length === 0, errors);
  console.log(`\nRESULT: ${fail ? 'FAIL' : 'PASS'}  (${pass} pass / ${fail} fail)`);
  console.log(JSON.stringify({ shots: { desktopShot, desktopShot2, mobileShot, landscapeShot }, errors }, null, 2));
  process.exitCode = fail ? 1 : 0;
  ws.close();
}
main().catch((e) => { console.error('错误:', e.message); process.exitCode = 3; }).finally(async () => { try { chrome.kill(); } catch { } await sleep(300); try { fs.rmSync(profile, { recursive: true, force: true }); } catch { } });
