// AI 自动玩浏览器验收（CDP，真实点击）：按钮、自动开始、局面推进、暂停/关闭/交还手动、三视口布局
// 用法: node tools/verify_tetris_ai.mjs（失败时 exit 1）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const ROOT = process.cwd();
const OUT = path.join(os.tmpdir(), 'tetris-ai-shots');
const PORT = 9740 + Math.floor(Math.random() * 120);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tetris-ai-'));
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
    if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || ''));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
  });
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const evalIn = async (expr) => {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error('eval error: ' + JSON.stringify(exceptionDetails));
    return result.value;
  };
  const viewport = async (w, h, mobile) => { await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile, screenWidth: w, screenHeight: h }); await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: !!mobile, maxTouchPoints: 5 }); await sleep(400); };
  const shot = async (name, w, h) => { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } }); const p = path.join(OUT, name); fs.writeFileSync(p, Buffer.from(data, 'base64')); return p; };
  const url = 'file:///' + path.join(ROOT, 'docs/tetris.html').replace(/\\/g, '/');

  await viewport(1500, 1000, false);
  let loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url });
  await Promise.race([loaded, sleep(15000)]);
  await sleep(1200);

  let s = await evalIn(`(() => {
    const b = document.getElementById('aiBtn');
    const r = b.getBoundingClientRect();
    return { exists: !!b, engine: typeof window.TetrisAI, aria: b.getAttribute('aria-pressed'), on: b.classList.contains('is-on'),
      text: b.innerText.trim(), rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      viewports: { scrollH: document.documentElement.scrollHeight, innerH: window.innerHeight, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth } };
  })()`);
  ok('AI 引擎已加载', s.engine === 'object', s.engine);
  ok('AI 按钮存在且未激活', s.exists && s.aria === 'false' && s.on === false);
  ok('按钮尺寸 >= 24', s.rect.w >= 24 && s.rect.h >= 24, s.rect);
  ok('桌面无滚动', s.viewports.scrollH <= s.viewports.innerH + 2 && s.viewports.scrollW <= s.viewports.innerW + 2, s.viewports);

  // 点击 AI → 自动开始并操作
  await evalIn(`document.getElementById('aiBtn').click()`);
  await sleep(500);
  s = await evalIn(`(() => ({ aria: document.getElementById('aiBtn').getAttribute('aria-pressed'), on: document.getElementById('aiBtn').classList.contains('is-on'), state: document.body.dataset.state, dbg: window.TetrisDebug.getState(), aiClass: document.body.classList.contains('ai-mode') }))()`);
  ok('点击后按钮激活', s.aria === 'true' && s.on === true);
  ok('点击后自动开始游戏', s.state === 'running', s.state);
  ok('AI 模式标记', s.aiClass === true);

  // 观察 8 秒，分数/行数应增长
  const before = await evalIn(`({ score: window.TetrisDebug.getState().score, lines: window.TetrisDebug.getState().lines })`);
  await sleep(8000);
  const after = await evalIn(`({ score: window.TetrisDebug.getState().score, lines: window.TetrisDebug.getState().lines, state: document.body.dataset.state, pieces: document.getElementById('score').textContent })`);
  ok('AI 8 秒内产生分数增长', after.score > before.score + 10, { before, after });
  ok('AI 未把游戏玩死（仍 running）', after.state === 'running', after.state);
  console.log('AI 8s: score', before.score, '->', after.score, 'lines', after.lines);

  const aiShot = await shot('tetris-ai-playing.png', 1500, 1000);

  // 长时间稳定性：再跑 25 秒，行数应显著增长
  await sleep(25000);
  const long = await evalIn(`({ score: window.TetrisDebug.getState().score, lines: window.TetrisDebug.getState().lines, level: window.TetrisDebug.getState().level, state: document.body.dataset.state })`);
  ok('AI 长时间运行行数 >= 10', long.lines >= 10, long);
  ok('AI 长时间运行仍存活', long.state === 'running', long.state);
  console.log('AI 33s: score', long.score, 'lines', long.lines, 'level', long.level);
  const aiShot2 = await shot('tetris-ai-long.png', 1500, 1000);

  // 关闭 AI
  await evalIn(`document.getElementById('aiBtn').click()`);
  await sleep(600);
  const off1 = await evalIn(`({ on: window.TetrisDebug.getState().aiMode, lines: window.TetrisDebug.getState().lines })`);
  await sleep(2500);
  const off2 = await evalIn(`({ on: window.TetrisDebug.getState().aiMode, lines: window.TetrisDebug.getState().lines })`);
  ok('关闭 AI 后停止自动操作', off1.on === false, off1);
  ok('关闭后行数基本不再自动增长', off2.lines - off1.lines <= 1, { off1, off2 });

  // 暂停时 AI 不操作
  await evalIn(`document.getElementById('aiBtn').click()`);
  await sleep(2000);
  await evalIn(`document.getElementById('pauseBtn').click()`);
  await sleep(300);
  const pausedBefore = await evalIn(`window.TetrisDebug.getState().lines`);
  await sleep(2000);
  const pausedAfter = await evalIn(`({ lines: window.TetrisDebug.getState().lines, state: window.TetrisDebug.getState().state })`);
  ok('暂停时 AI 停止', pausedAfter.state === 'paused' && pausedAfter.lines === pausedBefore, { pausedBefore, pausedAfter });
  // 继续后 AI 恢复
  await evalIn(`document.getElementById('pauseBtn').click()`);
  await sleep(3000);
  const resumed = await evalIn(`({ state: window.TetrisDebug.getState().state, lines: window.TetrisDebug.getState().lines, ai: window.TetrisDebug.getState().aiMode })`);
  ok('继续后 AI 恢复工作', resumed.state === 'running' && resumed.lines >= pausedAfter.lines, resumed);

  // 键盘接管
  await evalIn(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))`);
  await sleep(300);
  const handedOver = await evalIn(`({ ai: window.TetrisDebug.getState().aiMode, aria: document.getElementById('aiBtn').getAttribute('aria-pressed') })`);
  ok('手动按键交还控制', handedOver.ai === false && handedOver.aria === 'false', handedOver);

  // 手机布局
  await viewport(390, 844, true);
  loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: url + '?touch=1' });
  await Promise.race([loaded, sleep(15000)]);
  await sleep(1200);
  s = await evalIn(`(() => {
    const b = document.getElementById('aiBtn'); const r = b.getBoundingClientRect();
    const actions = document.querySelector('.actions').getBoundingClientRect();
    return { text: b.innerText.trim(), w: r.width, h: r.height, x: r.x, right: r.right, actionsRight: actions.right,
      scrollH: document.documentElement.scrollHeight, innerH: window.innerHeight, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth };
  })()`);
  ok('手机按钮文案缩短为 AI', s.text === 'AI', s.text);
  ok('手机无滚动无溢出', s.scrollH <= s.innerH + 2 && s.scrollW <= s.innerW + 2 && s.right <= s.innerW + 2, s);
  await evalIn(`document.getElementById('aiBtn').click()`);
  await sleep(4000);
  const mobileAI = await evalIn(`({ state: document.body.dataset.state, score: window.TetrisDebug.getState().score, ai: window.TetrisDebug.getState().aiMode })`);
  ok('手机端 AI 可运行', mobileAI.ai === true && mobileAI.state === 'running' && mobileAI.score > 0, mobileAI);
  const mobileShot = await shot('tetris-ai-mobile.png', 390, 844);

  // 横屏
  await viewport(844, 390, true);
  loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: url + '?touch=1' });
  await Promise.race([loaded, sleep(15000)]);
  await sleep(1200);
  s = await evalIn(`(() => { const b = document.getElementById('aiBtn'); const r = b.getBoundingClientRect();
    return { visible: r.width > 0 && getComputedStyle(b).display !== 'none', right: r.right,
      scrollH: document.documentElement.scrollHeight, innerH: window.innerHeight, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, scale: getComputedStyle(document.documentElement).getPropertyValue('--game-scale').trim() }; })()`);
  ok('横屏 AI 按钮可见且不溢出', s.visible === true && s.right <= s.innerW + 2, s);
  ok('横屏无滚动', s.scrollH <= s.innerH + 2 && s.scrollW <= s.innerW + 2, s);
  const landscapeShot = await shot('tetris-ai-landscape.png', 844, 390);

  ok('无页面异常', errors.filter(e => !/NotAllowedError|播放失败/.test(e)).length === 0, errors);
  console.log(`\nRESULT: ${fail ? 'FAIL' : 'PASS'} (${pass} pass / ${fail} fail)`);
  console.log(JSON.stringify({ shots: { aiShot, aiShot2, mobileShot, landscapeShot }, errors }, null, 2));
  process.exitCode = fail ? 1 : 0;
  ws.close();
}
main().catch((e) => { console.error('错误:', e.message); process.exitCode = 3; }).finally(async () => { try { chrome.kill(); } catch { } await sleep(300); try { fs.rmSync(profile, { recursive: true, force: true }); } catch { } });
