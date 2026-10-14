/**
 * 浏览器级验证（Chrome DevTools Protocol，Node 内置 WebSocket，无第三方依赖）
 *
 * 用法: node tools/verify_browser.mjs <repoRoot> <page.html> [page2.html ...]
 *
 * 对每个页面输出：.katex 数量、katex-error 数量、残留 \(...\) 文本、DOM 节点数、
 * DOMContentLoaded / loadEventEnd 毫秒数、强制完整布局耗时、文档总高度。
 *
 * 判定：katex-error > 0 或残留定界符 > 0 直接非零退出。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME = process.env.CHROME ||
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const ROOT = path.resolve(process.argv[2] || ".");
const PAGES = process.argv.slice(3);
if (!PAGES.length) {
  console.error("usage: node tools/verify_browser.mjs <repoRoot> <page.html> [...]");
  process.exit(2);
}

const PORT = 9200 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "jys-cdp-"));

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-proxy-server", "--no-first-run",
  "--disable-extensions", "--allow-file-access-from-files",
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
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  once(method) {
    return new Promise((res) => {
      const list = this.handlers.get(method) || [];
      list.push(res);
      this.handlers.set(method, list);
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) {
    try { ready = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch { }
    if (!ready) await sleep(250);
  }
  if (!ready) throw new Error("DevTools 端口未就绪");

  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = targets.find((t) => t.type === "page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  const cdp = new CDP(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  const probe = `(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const t0 = performance.now();
    const height = document.documentElement.scrollHeight;
    void document.body.offsetHeight;
    const layoutMs = performance.now() - t0;
    const txt = document.body.innerText || '';
    return JSON.stringify({
      katex: document.querySelectorAll('.katex').length,
      err: document.querySelectorAll('.katex-error').length,
      left: (txt.match(/\\\\\\(/g) || []).length,
      nodes: document.getElementsByTagName('*').length,
      docMs: Math.round(nav.domContentLoadedEventEnd || 0),
      loadMs: Math.round(nav.loadEventEnd || nav.duration || 0),
      layoutMs: Math.round(layoutMs * 10) / 10,
      height: height,
      bytes: document.documentElement.outerHTML.length
    });
  })()`;

  const rows = [];
  let bad = 0;
  for (const p of PAGES) {
    const abs = path.resolve(ROOT, p);
    const url = "file:///" + abs.replace(/\\/g, "/");
    const kb = fs.existsSync(abs) ? Math.round(fs.statSync(abs).size / 1024) : -1;
    const loaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url });
    await Promise.race([loaded, sleep(30000)]);
    await sleep(250);
    const r = await cdp.send("Runtime.evaluate", { expression: probe, returnByValue: true });
    const v = JSON.parse(r.result.value);
    const ok = v.err === 0 && v.left === 0;
    if (!ok) bad++;
    rows.push({
      页面: path.basename(p),
      KB: kb,
      kaTeX: v.katex,
      err: v.err,
      left: v.left,
      节点: v.nodes,
      DCLms: v.docMs,
      loadMs: v.loadMs,
      layoutMs: v.layoutMs,
      高度px: v.height,
      ok
    });
  }

  const pad = (s, n) => String(s).padEnd(n, " ");
  console.log(pad("页面", 36) + pad("KB", 6) + pad("kaTeX", 7) + pad("err", 5) +
    pad("left", 6) + pad("节点", 8) + pad("DCLms", 7) + pad("loadMs", 8) +
    pad("layoutMs", 10) + pad("高度", 8) + "结果");
  for (const r of rows) {
    console.log(pad(r.页面, 36) + pad(r.KB, 6) + pad(r.kaTeX, 7) + pad(r.err, 5) +
      pad(r.left, 6) + pad(r.节点, 8) + pad(r.DCLms, 7) + pad(r.loadMs, 8) +
      pad(r.layoutMs, 10) + pad(r.高度px, 8) + (r.ok ? "OK" : "FAIL"));
  }
  const maxLoad = Math.max(...rows.map((r) => r.loadMs));
  const maxLayout = Math.max(...rows.map((r) => r.layoutMs));
  console.log(`\n最大 load=${maxLoad}ms，最大强制布局=${maxLayout}ms，失败页面=${bad}`);
  ws.close();
  process.exit(bad ? 1 : 0);
}

main()
  .catch((e) => { console.error("错误:", e.message); process.exitCode = 3; })
  .finally(async () => {
    try { chrome.kill(); } catch { }
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { }
  });
