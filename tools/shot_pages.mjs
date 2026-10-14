/**
 * 全页截图（CDP captureBeyondViewport），用于讲义视觉验收。
 * 用法: node tools/shot_pages.mjs <repoRoot> <outDir> <page.html> [page2.html ...]
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME = process.env.CHROME || "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const ROOT = path.resolve(process.argv[2] || ".");
const OUT = path.resolve(process.argv[3] || ".");
const PAGES = process.argv.slice(4);
if (!PAGES.length) { console.error("usage: node tools/shot_pages.mjs <repoRoot> <outDir> <page...>"); process.exit(2); }

const PORT = 9700 + Math.floor(Math.random() * 300);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "jys-shot-"));
fs.mkdirSync(OUT, { recursive: true });

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
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });

  for (const p of PAGES) {
    const url = "file:///" + path.resolve(ROOT, p).replace(/\\/g, "/");
    const loaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url });
    await Promise.race([loaded, sleep(20000)]);
    await sleep(400);
    // 展开所有 details，便于一次性看到答案排版
    await cdp.send("Runtime.evaluate", { expression: "document.querySelectorAll('details').forEach(d=>d.open=true)" });
    await sleep(200);
    const { result } = await cdp.send("Runtime.evaluate", { expression: "JSON.stringify({h:document.documentElement.scrollHeight})", returnByValue: true });
    const h = Math.min(JSON.parse(result.value).h, 30000);
    const shot = await cdp.send("Page.captureScreenshot", {
      format: "png", captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 1500, height: h, scale: 1 }
    });
    const name = path.basename(p).replace(/\.html$/, "") + ".png";
    fs.writeFileSync(path.join(OUT, name), Buffer.from(shot.data, "base64"));
    console.log(`${name}  ${1500}x${h}  ${Math.round(fs.statSync(path.join(OUT, name)).size / 1024)}KB`);
  }
  ws.close();
}

main().catch((e) => { console.error("错误:", e.message); process.exitCode = 3; })
  .finally(async () => {
    try { chrome.kill(); } catch { }
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { }
  });
