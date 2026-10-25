/**
 * 留言板云端联调验收（CDP，跑在已发布的域名上）
 *
 * 用法: node tools/verify_guestbook.mjs [url]
 *   默认 url = https://fxhook-site.app.workbuddy.host/pages/communicate.html
 *
 * 为什么必须在线上域名跑：云服务数据面校验 Origin，file:// 或 localhost 的
 * Origin 不匹配，读请求会被拒，测不出真实结果。
 *
 * 检查项：
 *   1. 云 SDK 加载成功（window.WorkBuddyCloud 存在）
 *   2. 首次加载能读出留言列表（.gb-status 不报错）
 *   3. 提交一条留言后，列表新增且状态为成功
 *   4. 刷新页面后，刚提交的留言仍在（真正落库，不是内存）
 *   5. 全程无未捕获 JS 异常
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME = process.env.CHROME || "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const URL_ = process.argv[2] || "https://fxhook-site.app.workbuddy.host/pages/communicate.html";
const PORT = 9700 + Math.floor(Math.random() * 300);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "jys-gb-"));

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--disable-extensions",
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
  await cdp.send("Runtime.enable");

  const errors = [];
  const errs = cdp.handlers.get("Runtime.exceptionThrown") || [];
  errs.push((p) => { if (p.exceptionDetails) errors.push(p.exceptionDetails.text || "exception"); });
  cdp.handlers.set("Runtime.exceptionThrown", errs);

  const evalJs = async (expr) => {
    const { result } = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return result.value;
  };

  const load = async () => {
    const loaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url: URL_ });
    await Promise.race([loaded, sleep(25000)]);
    await sleep(2500);
  };

  const stamp = "验收留言 " + new Date().toISOString().slice(11, 19);

  await load();

  const sdk = await evalJs("!!(window.WorkBuddyCloud && window.WorkBuddyCloud.createWorkBuddyCloud)");
  const before = await evalJs("document.querySelectorAll('.gb-item').length");
  const initStatus = await evalJs("(document.getElementById('gb-status')||{}).textContent || ''");

  await evalJs(`(() => {
    document.getElementById('gb-name').value = '验收机器人';
    document.getElementById('gb-message').value = ${JSON.stringify(stamp)};
    document.getElementById('gb-form').dispatchEvent(new Event('submit', {cancelable:true}));
    return true;
  })()`);
  await sleep(3500);

  const afterStatus = await evalJs("(document.getElementById('gb-status')||{}).textContent || ''");
  const afterCount = await evalJs("document.querySelectorAll('.gb-item').length");
  const firstText = await evalJs("(document.querySelector('.gb-item-text')||{}).textContent || ''");

  // 重新加载，确认真的落库而不是只在前端内存里
  await load();
  const persisted = await evalJs("Array.from(document.querySelectorAll('.gb-item-text')).some(e => e.textContent.indexOf(" + JSON.stringify(stamp) + ") >= 0)");

  const pass = sdk && errors.length === 0 && afterCount === before + 1
    && firstText.indexOf(stamp) >= 0 && persisted;

  console.log(`SDK 加载        : ${sdk}`);
  console.log(`加载时状态文案   : ${initStatus || "(空)"}`);
  console.log(`提交前条数       : ${before}`);
  console.log(`提交后状态文案   : ${afterStatus}`);
  console.log(`提交后条数       : ${afterCount}`);
  console.log(`刷新后仍在库中   : ${persisted}`);
  console.log(`JS 异常          : ${errors.length ? errors.join("; ") : "无"}`);
  console.log(`\n${pass ? "PASS" : "FAIL"}  留言板云端读写`);

  ws.close();
  return pass ? 0 : 1;
}

main().then((c) => { process.exitCode = c; })
  .catch((e) => { console.error("错误:", e.message); process.exitCode = 3; })
  .finally(async () => {
    try { chrome.kill(); } catch { }
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { }
  });
