/**
 * AI 节奏随等级加快的验收（CDP 真浏览器）。
 *
 * 断言：AI 放块速度（块/秒）随等级单调上升；简单模式下保持恒定
 *       （简单模式 = 等级提升不加速，AI 也应遵守同一条规则）。
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
      const s = await evalIn(`(() => { const d = window.TetrisDebug.getState(); return { level: d.level, pieces: d.pieces, state: d.state }; })()`);
      const t = Date.now();
      if (prev) samples.push({ dt: (t - prev.t) / 1000, level: prev.level, dPieces: s.pieces - prev.pieces });
      prev = { pieces: s.pieces, t, level: s.level };
      if (s.state !== 'running') break;
    }
    const byLevel = {};
    for (const s of samples) {
      if (!byLevel[s.level]) byLevel[s.level] = { sec: 0, pieces: 0 };
      byLevel[s.level].sec += s.dt;
      byLevel[s.level].pieces += s.dPieces;
    }
    const table = Object.keys(byLevel).map(Number).sort((a, b) => a - b)
      .map((lv) => ({ level: lv, pps: +(byLevel[lv].pieces / byLevel[lv].sec).toFixed(2), sec: +byLevel[lv].sec.toFixed(1) }));
    await evalIn(`document.getElementById('aiBtn').click()`);
    return table;
  }

  const normal = await sampleRun(false, 34);
  const easy = await sampleRun(true, 16);

  ok('正常模式：采到 >=3 个等级', normal.length >= 3, normal);
  const lv1 = normal.find((r) => r.level === 1);
  const last = normal[normal.length - 1];
  ok('正常模式：高等级明显快于 1 级（>=1.3 倍）', !!lv1 && last.pps >= lv1.pps * 1.3, { lv1, last });
  let monotonicBreaks = 0;
  for (let i = 1; i < normal.length; i++) if (normal[i].pps < normal[i - 1].pps * 0.9) monotonicBreaks++;
  ok('正常模式：速度整体单调上升（容差 10%）', monotonicBreaks <= 1, { normal, monotonicBreaks });

  ok('简单模式：采到 >=2 个等级', easy.length >= 2, easy);
  const easyMin = Math.min(...easy.map((r) => r.pps));
  const easyMax = Math.max(...easy.map((r) => r.pps));
  ok('简单模式：速度基本恒定（最高/最低 <=1.25 倍）', easyMax / easyMin <= 1.25, { easy, ratio: +(easyMax / easyMin).toFixed(2) });

  console.log('\n正常模式（块/秒）：' + normal.map((r) => `lv${r.level}=${r.pps}`).join('  '));
  console.log('简单模式（块/秒）：' + easy.map((r) => `lv${r.level}=${r.pps}`).join('  '));
  console.log(`\nRESULT: ${fail ? 'FAIL' : 'PASS'} (${pass} pass / ${fail} fail)`);
  process.exitCode = fail ? 1 : 0;
  ws.close();
}
main().catch((e) => { console.error('错误:', e.message); process.exitCode = 3; }).finally(async () => { try { chrome.kill(); } catch { } await sleep(300); try { fs.rmSync(profile, { recursive: true, force: true }); } catch { } });
