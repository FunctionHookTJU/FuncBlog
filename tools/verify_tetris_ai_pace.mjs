/**
 * AI 操作速度恒定 + 游戏重力仍随等级加速 的验收（CDP 真浏览器）。
 *
 * 两条独立断言：
 *   1) AI 放块速度不随等级变化（AI 操作速度恒定）；
 *   2) 重力确实随等级加速（dropInterval 单调下降，且最低到 80ms 下限）。
 * 另验证简单模式：重力不再加速（dropInterval 恒定 800ms），AI 速度依然恒定。
 *
 * 用法: node tools/verify_tetris_ai_pace.mjs（失败时 exit 1）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const ROOT = process.cwd();
const PORT = 9430 + Math.floor(Math.random() * 60);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tetris-ai-pace-'));
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
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
  const evalIn = async (expr) => (await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  const url = 'file:///' + path.join(ROOT, 'docs/tetris.html').replace(/\\/g, '/');
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url });
  await Promise.race([loaded, sleep(15000)]);
  await sleep(1200);

  // 纯计算：重力曲线本身是否正确（不依赖对局）
  const gravity = await evalIn(`(() => {
    const out = [];
    for (const lv of [1, 2, 5, 10, 12, 20, 50, 200]) out.push({ lv, interval: TetrisDebug.intervalForLevel(lv) });
    return out;
  })()`);
  ok('重力随等级单调下降', gravity.every((r, i) => i === 0 || r.interval <= gravity[i - 1].interval), gravity);
  ok('重力下限 80ms（高等级不会归零）', gravity.every((r) => r.interval >= 80), gravity);
  ok('1 级为 800ms', gravity[0].interval === 800, gravity[0]);
  ok('高等级到 80ms（12 级起）', gravity.find((r) => r.lv === 12).interval === 80, gravity.find((r) => r.lv === 12));

  async function sampleRun(easy, iterations) {
    await evalIn(`(() => {
      const d = window.TetrisDebug.getState();
      if (d.easyMode !== ${easy}) document.getElementById('easyBtn').click();
      if (d.aiMode) document.getElementById('aiBtn').click();
      document.getElementById('aiBtn').click();
    })()`);
    await sleep(1200);
    const samples = [];
    let prev = null;
    for (let i = 0; i < iterations; i++) {
      await sleep(2500);
      const s = await evalIn(`(() => { const d = window.TetrisDebug.getState(); return { level: d.level, pieces: d.pieces, state: d.state, interval: d.dropInterval }; })()`);
      const t = Date.now();
      if (prev) samples.push({ dt: (t - prev.t) / 1000, level: prev.level, dPieces: s.pieces - prev.pieces, interval: prev.interval });
      prev = { pieces: s.pieces, t, level: s.level, interval: s.interval };
      if (s.state !== 'running') break;
    }
    const byLevel = {};
    for (const s of samples) {
      if (!byLevel[s.level]) byLevel[s.level] = { sec: 0, pieces: 0, interval: s.interval };
      byLevel[s.level].sec += s.dt;
      byLevel[s.level].pieces += s.dPieces;
      byLevel[s.level].interval = s.interval;
    }
    const table = Object.keys(byLevel).map(Number).sort((a, b) => a - b)
      .map((lv) => ({ level: lv, pps: +(byLevel[lv].pieces / byLevel[lv].sec).toFixed(2), interval: byLevel[lv].interval, sec: +byLevel[lv].sec.toFixed(1) }));
    await evalIn(`document.getElementById('aiBtn').click()`);
    return table;
  }

  const normal = await sampleRun(false, 34);
  const easy = await sampleRun(true, 16);

  ok('正常模式：采到 >=3 个等级', normal.length >= 3, normal);
  const minPps = Math.min(...normal.map((r) => r.pps));
  const maxPps = Math.max(...normal.map((r) => r.pps));
  ok('AI 操作速度恒定（最高/最低 <=1.3 倍）', maxPps / minPps <= 1.3, { normal, ratio: +(maxPps / minPps).toFixed(2) });
  ok('正常模式：重力随等级变快（首末等级 interval 下降）',
    normal.length >= 2 && normal[normal.length - 1].interval < normal[0].interval,
    normal.map((r) => ({ lv: r.level, interval: r.interval })));

  ok('简单模式：采到 >=2 个等级', easy.length >= 2, easy);
  const easyIntervals = [...new Set(easy.map((r) => r.interval))];
  ok('简单模式：重力保持 800ms 不加速', easyIntervals.length === 1 && easyIntervals[0] === 800, easy);
  const eMin = Math.min(...easy.map((r) => r.pps));
  const eMax = Math.max(...easy.map((r) => r.pps));
  ok('简单模式：AI 速度同样恒定（<=1.3 倍）', eMax / eMin <= 1.3, { easy, ratio: +(eMax / eMin).toFixed(2) });

  console.log('\n重力曲线：' + gravity.map((r) => `lv${r.lv}=${r.interval}ms`).join('  '));
  console.log('正常模式 AI：' + normal.map((r) => `lv${r.level}=${r.pps}块/秒(重力${r.interval}ms)`).join('  '));
  console.log('简单模式 AI：' + easy.map((r) => `lv${r.level}=${r.pps}块/秒(重力${r.interval}ms)`).join('  '));
  console.log(`\nRESULT: ${fail ? 'FAIL' : 'PASS'} (${pass} pass / ${fail} fail)`);
  process.exitCode = fail ? 1 : 0;
  ws.close();
}
main().catch((e) => { console.error('错误:', e.message); process.exitCode = 3; }).finally(async () => { try { chrome.kill(); } catch { } await sleep(300); try { fs.rmSync(profile, { recursive: true, force: true }); } catch { } });
