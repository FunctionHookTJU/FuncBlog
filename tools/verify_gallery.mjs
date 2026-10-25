/**
 * 图片墙「最新上传」验收（CDP，跑在已发布域名上）
 *
 * 用法:
 *   GALLERY_PW=****** node tools/verify_gallery.mjs [url]
 *   默认 url = https://fxhook-site.app.workbuddy.host/pages/picture.html
 *
 * 密码从环境变量读，不写进仓库。
 *
 * 验证的是权限模型本身，不只是界面能跑：
 *   1. 云 SDK 加载、列表能读（匿名访客可看）
 *   2. 匿名直连 gallery_photos 做 INSERT -> 必须被拒（写权限根本不在客户端）
 *   3. 密码错误调 gallery_add_photo -> 必须被拒
 *   4. 密码正确调 gallery_add_photo -> 成功，且新行出现在列表里
 *   5. 密码正确调 gallery_del_photo -> 成功，行被删掉（收尾，不留测试数据）
 *   6. 全程无未捕获 JS 异常
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME = process.env.CHROME || "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const URL_ = process.argv[2] || "https://fxhook-site.app.workbuddy.host/pages/picture.html";
const PW = process.env.GALLERY_PW || "";
const PORT = 9700 + Math.floor(Math.random() * 300);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "jys-gal-"));

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
    if (result && result.subtype === "error") return "__ERR__:" + (result.description || "");
    return result.value;
  };

  const loaded = cdp.once("Page.loadEventFired");
  await cdp.send("Page.navigate", { url: URL_ });
  await Promise.race([loaded, sleep(25000)]);
  await sleep(2500);

  const results = [];
  const check = (name, ok, extra) => { results.push({ name, ok, extra }); };

  const sdk = await evalJs("!!(window.WorkBuddyCloud && window.WorkBuddyCloud.createWorkBuddyCloud)");
  check("云 SDK 已加载", sdk === true);

  // 页面自己的 script 是 IIFE，没有暴露 client；这里用全局重新建一个同配置的客户端做接口级验证
  await evalJs(`(() => {
    window.__probe = window.WorkBuddyCloud.createWorkBuddyCloud({
      endpoint: 'https://fxhook-site.app.workbuddy.host',
      oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
      publishableKey: 'wbpk_8BvBV5X9GIf3XHlxJd1hmU_ldb7SRvlx2Gl62I0L8A7D6P6xQUMN2fv'
    });
    return true;
  })()`);

  const listRes = await evalJs(`window.__probe.database.from('gallery_photos').select('id').limit(1).then(r => JSON.stringify({err: !!r.error, n: (r.data||[]).length}))`);
  check("匿名可读列表", /"err":false/.test(String(listRes)), String(listRes));

  const directInsert = await evalJs(`window.__probe.database.from('gallery_photos').insert({title:'x', mime:'image/jpeg', data:'AAAA'}).select().then(r => JSON.stringify({err: !!r.error, code: r.error && r.error.code}))`);
  check("匿名直连 INSERT 被拒", /"err":true/.test(String(directInsert)), String(directInsert));

  const wrongPw = await evalJs(`window.__probe.database.rpc('gallery_add_photo', {pw:'definitely-wrong', p_title:'t', p_mime:'image/jpeg', p_data:'A'.repeat(200)}).then(r => JSON.stringify({err: !!r.error, code: r.error && r.error.code}))`);
  check("密码错误被拒", /"err":true/.test(String(wrongPw)), String(wrongPw));

  if (PW) {
    const stamp = "验收图 " + new Date().toISOString().slice(11, 19);
    const addRes = await evalJs(`window.__probe.database.rpc('gallery_add_photo', {pw:${JSON.stringify(PW)}, p_title:${JSON.stringify(stamp)}, p_mime:'image/png', p_data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='}).then(r => JSON.stringify({err: !!r.error, id: r.data, code: r.error && r.error.code}))`);
    const addOk = /"err":false/.test(String(addRes));
    check("密码正确可上传", addOk, String(addRes));

    const idMatch = String(addRes).match(/"id":(\d+)/);
    const newId = idMatch ? idMatch[1] : null;

    if (newId) {
      const visible = await evalJs(`window.__probe.database.from('gallery_photos').select('id,title').eq('id', ${newId}).single().then(r => JSON.stringify({err: !!r.error, title: r.data && r.data.title}))`);
      check("新照片可被匿名读到", /"err":false/.test(String(visible)) && String(visible).indexOf(stamp) >= 0, String(visible));

      const delRes = await evalJs(`window.__probe.database.rpc('gallery_del_photo', {pw:${JSON.stringify(PW)}, p_id:${newId}}).then(r => JSON.stringify({err: !!r.error, ok: r.data}))`);
      check("密码正确可删除", /"err":false/.test(String(delRes)) && /"ok":true/.test(String(delRes)), String(delRes));

      const gone = await evalJs(`window.__probe.database.from('gallery_photos').select('id').eq('id', ${newId}).then(r => JSON.stringify({err: !!r.error, n: (r.data||[]).length}))`);
      check("删除后不可见", /"n":0/.test(String(gone)), String(gone));
    }
  } else {
    results.push({ name: "上传/删除（跳过：未提供 GALLERY_PW）", ok: true, extra: "" });
  }

  check("无未捕获 JS 异常", errors.length === 0, errors.join("; "));

  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.extra ? "    " + r.extra : ""}`);
  }
  console.log(`\n${failed ? "FAIL" : "PASS"}  共 ${results.length} 项，失败 ${failed} 项`);

  ws.close();
  return failed ? 1 : 0;
}

main().then((c) => { process.exitCode = c; })
  .catch((e) => { console.error("错误:", e.message); process.exitCode = 3; })
  .finally(async () => {
    try { chrome.kill(); } catch { }
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { }
  });
