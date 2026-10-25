/**
 * 外壳功能冒烟测试（CDP）：验证 scripts/site-shell.js 在各类页面上真的跑起来了。
 *
 * 用法: node tools/check_shell_runtime.mjs <page.html> [page2.html ...]
 *
 * 检查项：
 *   1. mobile-menu-btn 点击后 .nav-links 会带上 mobile-open（移动端菜单已绑定）
 *   2. 窗口收到过 headerLoaded 事件（audioPlayer.js 靠它重绑按钮）
 *   3. 页面无未捕获的 JS 错误
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME = process.env.CHROME || "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const ROOT = process.cwd();
const PAGES = process.argv.slice(2);
if (!PAGES.length) { console.error("usage: node tools/check_shell_runtime.mjs <page...>"); process.exit(2); }

const PORT = 9700 + Math.floor(Math.random() * 300);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "jys-shell-"));

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-proxy-server", "--no-first-run", "--disable-extensions",
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, "about:blank"
], { stdio: "ignore" });

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method) {
        const list = this.handlers.get(m.method) || [];
        this.handlers.set(m.method, []);
        for (const f of list) f(m.params);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  once(method) { return new Promise((res) => { const l = this.handlers.get(method) || []; l.push(res); this.handlers.set(method, l); }); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalIn(cdp, expression) {
  const { result } = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return result.value;
}

async function main() {
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) {
    try { ready = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch { }
    if (!ready) await sleep(250);
  }
  if (!ready) throw new Error("DevTools 未就绪");
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  const cdp = new CDP(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  // 在页面脚本执行前插桩，捕获 headerLoaded（只注册一次，否则每轮都会累加）
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: "window.__headerLoaded = 0; window.addEventListener('headerLoaded', function(){ window.__headerLoaded++; });"
  });

  let failed = 0;
  for (const p of PAGES) {
    const errors = [];
    const onErr = (params) => {
      if (params.exceptionDetails) errors.push(params.exceptionDetails.text || "exception");
    };
    const listeners = cdp.handlers.get("Runtime.exceptionThrown") || [];
    listeners.push(onErr);
    cdp.handlers.set("Runtime.exceptionThrown", listeners);

    const url = "file:///" + path.resolve(ROOT, p).replace(/\\/g, "/");
    const loaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url });
    await Promise.race([loaded, sleep(20000)]);
    await sleep(500);

    const res = await evalIn(cdp, `(() => {
      const btn = document.getElementById('mobile-menu-btn');
      const links = document.querySelector('.nav-links');
      const before = links ? links.className : '';
      if (btn) btn.click();
      const after = links ? links.className : '';
      const menuOk = after !== before && after.indexOf('mobile-open') >= 0;
      return JSON.stringify({
        hasHeader: !!document.querySelector('header'),
        headerLoaded: window.__headerLoaded || 0,
        menuOk: menuOk,
        shellJs: !!document.querySelector('script[src*="site-shell.js"]')
      });
    })()`);
    const r = JSON.parse(res);
    const ok = r.hasHeader && r.menuOk && r.shellJs && errors.length === 0;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${p}`);
    console.log(`      header=${r.hasHeader} menuToggle=${r.menuOk} headerLoaded=${r.headerLoaded} shellJs=${r.shellJs} errors=${errors.length ? errors.join("; ") : "none"}`);
  }
  ws.close();
  return failed;
}

main().then((f) => { process.exitCode = f ? 1 : 0; })
  .catch((e) => { console.error("错误:", e.message); process.exitCode = 3; })
  .finally(async () => {
    try { chrome.kill(); } catch { }
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { }
  });
