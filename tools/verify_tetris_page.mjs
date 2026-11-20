/**
 * 俄罗斯方块页面（docs/tetris.html）独立浏览器验收
 * 本机 Chrome（headless=new）+ CDP，零第三方依赖。
 *
 * 用法:
 *   node tools/verify_tetris_page.mjs [repoRoot] [outDir]
 *
 * 默认 repoRoot = 当前目录，outDir = <系统临时目录>/tetris-shots
 *
 * 覆盖：
 *   H 站点统一 header（7 条导航 / logo 头像 / 移动端汉堡菜单 / 不遮挡游戏）
 *   A 背景音乐（#audio-player、静音按钮、切源按钮；file:// 自动播放 NotAllowedError 仅 INFO）
 *   G 游戏交互（真实点击开始 / 真实键盘事件 / 暂停继续 / 重开归零 / 最高分 localStorage）
 *   D 桌面 1500×1000 布局 + 截图
 *   M 390×844 触屏：汉堡菜单 + 触屏按钮真实 touch 操作
 *   P 390×844 布局 + 截图
 *   L 844×390 横屏布局 + 截图
 *   C 控制台（Runtime.exceptionThrown / console.error）
 *
 * 只读取页面，不修改任何站点文件；截图仅写入 outDir。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import crypto from "node:crypto";

const CHROME = process.env.CHROME ||
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const ROOT = path.resolve(process.argv[2] || process.cwd());
const OUT = path.resolve(process.argv[3] || path.join(os.tmpdir(), "tetris-shots"));
const PAGE = path.join(ROOT, "docs", "tetris.html");
const PORT = 9600 + Math.floor(Math.random() * 300);

const VIEW_DESKTOP = { w: 1500, h: 1000 };
const VIEW_MOBILE = { w: 390, h: 844 };
const VIEW_LANDSCAPE = { w: 844, h: 390 };

const EXPECTED_NAV = ["首页", "日记", "学习笔记", "Github", "交流", "图片墙", "新产品"];

function pageFingerprint() {
  const buf = fs.readFileSync(PAGE);
  return {
    sha256: crypto.createHash("sha256").update(buf).digest("hex"),
    bytes: buf.length,
    mtime: fs.statSync(PAGE).mtime.toISOString()
  };
}

fs.mkdirSync(OUT, { recursive: true });

/* ============================ 报告 ============================ */
const results = [];
const infos = [];
const notes = [];
const screenshots = [];

function record(id, title, ok, evidence) {
  ok = !!ok;
  results.push({ ok, id, title, evidence });
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${id} ${title}`);
  if (!ok) console.log(`        证据: ${short(evidence)}`);
}
function info(id, title, detail) {
  infos.push({ id, title, detail });
  console.log(`[INFO] ${id} ${title}${detail !== undefined ? " — " + short(detail) : ""}`);
}
function short(v) {
  let s;
  try { s = typeof v === "string" ? v : JSON.stringify(v); } catch { s = String(v); }
  if (s === undefined) s = String(v);
  return s.length > 900 ? s.slice(0, 900) + "…" : s;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================ Chrome / CDP ============================ */
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tetris-verify-"));
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-proxy-server", "--no-first-run",
  "--disable-extensions", "--allow-file-access-from-files", "--mute-audio",
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, "about:blank"
], { stdio: "ignore" });

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.waiters = new Map();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
        return;
      }
      if (m.method) {
        for (const f of this.listeners.get(m.method) || []) {
          try { f(m.params); } catch { /* 忽略监听器内部错误 */ }
        }
        const waiters = this.waiters.get(m.method);
        if (waiters && waiters.length) {
          this.waiters.set(m.method, []);
          for (const w of waiters) w(m.params);
        }
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
  on(method, fn) {
    const list = this.listeners.get(method) || [];
    list.push(fn);
    this.listeners.set(method, list);
  }
  once(method) {
    return new Promise((res) => {
      const list = this.waiters.get(method) || [];
      list.push(res);
      this.waiters.set(method, list);
    });
  }
}

/* 页面异常 / 控制台消息 */
const consoleErrors = [];
const consoleOthers = [];
const pageExceptions = [];

function fmtArg(a) {
  if (!a) return "";
  if (a.value !== undefined) return typeof a.value === "string" ? a.value : JSON.stringify(a.value);
  if (a.unserializableValue) return String(a.unserializableValue);
  if (a.description) return String(a.description);
  return a.type || "";
}
function fmtLoc(stack) {
  const f = stack && stack.callFrames && stack.callFrames[0];
  return f ? `${f.url || ""}:${(f.lineNumber || 0) + 1}` : "";
}

/* file:// 下站点原有行为（记录，不判 FAIL） */
const KNOWN_CONSOLE = [
  { re: /NotAllowedError|play\(\)|autoplay|自动播放|音频|audio|播放失败|音乐/i, label: "file:// 下音频自动播放/加载受限（站点原有行为）" },
  { re: /webmanifest|manifest/i, label: "file:// 下 site.webmanifest 加载/CORS 受限（站点原有行为）" }
];
function classifyConsole(text) {
  for (const k of KNOWN_CONSOLE) if (k.re.test(String(text))) return k.label;
  return null;
}

let cdp = null;

/* ============================ 页面内快照 ============================ */
function pageSnapshot() {
  var q = function (s) { return document.querySelector(s); };
  var qa = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var vis = function (n) {
    if (!n || n.hidden) return false;
    var cs = getComputedStyle(n);
    if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return false;
    return n.getClientRects().length > 0;
  };
  var num = function (v) { var n = Math.round(v * 10) / 10; return n; };
  var rect = function (n) {
    if (!n) return null;
    var r = n.getBoundingClientRect();
    return { x: num(r.x), y: num(r.y), w: num(r.width), h: num(r.height), right: num(r.right), bottom: num(r.bottom) };
  };
  var cvInfo = function (cv) {
    var out = { exists: !!cv, cssW: cv ? num(cv.getBoundingClientRect().width) : null, pxW: cv ? cv.width : null, pxH: cv ? cv.height : null, len: 0, hash: 0, colors: 0, sum: 0, bbox: null };
    if (!cv || !cv.width || !cv.height) return out;
    try {
      var durl = cv.toDataURL("image/png");
      out.len = durl.length;
      var hh = 0;
      for (var ci = 0; ci < durl.length; ci++) hh = (hh * 31 + durl.charCodeAt(ci)) >>> 0;
      out.hash = hh;
    } catch (e) { out.len = -1; out.hash = -1; }
    try {
      var px = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
      var bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1, bc = 0;
      for (var by = 0; by < cv.height; by += 2) {
        for (var bx = 0; bx < cv.width; bx += 2) {
          var ii = (by * cv.width + bx) * 4;
          if (Math.max(px[ii], px[ii + 1], px[ii + 2]) > 90) {
            bc++;
            if (bx < bx0) bx0 = bx;
            if (bx > bx1) bx1 = bx;
            if (by < by0) by0 = by;
            if (by > by1) by1 = by;
          }
        }
      }
      out.bbox = bc ? { x: bx0, y: by0, right: bx1, bottom: by1, count: bc } : null;
    } catch (e) { out.bbox = null; }
    try {
      var w = 40, h = 80;
      var t = document.createElement("canvas");
      t.width = w; t.height = h;
      var tc = t.getContext("2d");
      tc.drawImage(cv, 0, 0, w, h);
      var d = tc.getImageData(0, 0, w, h).data, set = {}, ssum = 0;
      for (var i = 0; i < d.length; i += 4) {
        set[(d[i] >> 4) + "," + (d[i + 1] >> 4) + "," + (d[i + 2] >> 4)] = 1;
        ssum = (ssum + d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7 + i) % 1000000007;
      }
      out.colors = Object.keys(set).length;
      out.sum = ssum;
    } catch (e) { out.colors = -1; out.sum = -1; }
    return out;
  };
  var header = q("header");
  var navLinks = q(".nav-links");
  var audio = q("#audio-player");
  var tc = q("#touchControls");
  var boardWrap = q(".board-wrap");
  var overlay = q("#overlay");
  var startBtn = q("#startBtn");
  var mute = q("#mute-button");
  var toggle = q("#toggle-audio-source");
  var mmb = q("#mobile-menu-btn");
  var logoAvatar = q("header .logo-avatar");
  var hcs = header ? getComputedStyle(header) : null;
  var navCs = navLinks ? getComputedStyle(navLinks) : null;
  var rootCs = getComputedStyle(document.documentElement);
  var pauseBtn = q("#pauseBtn");
  var restartBtn = q("#restartBtn");
  var tcButtons = qa("#touchControls .tc").map(function (b) {
    var r = b.getBoundingClientRect();
    var hit = null;
    try { hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); } catch (e) {}
    return {
      act: b.dataset.act,
      rect: rect(b),
      visible: vis(b),
      hitSelf: !!(hit && (hit === b || b.contains(hit))),
      hitTag: hit ? (hit.id ? "#" + hit.id : hit.tagName) : null,
      isOn: b.classList.contains("is-on")
    };
  });
  return {
    url: location.href,
    readyState: document.readyState,
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio, scrollX: window.scrollX, scrollY: window.scrollY },
    doc: {
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientWidth: document.documentElement.clientWidth,
      clientHeight: document.documentElement.clientHeight,
      bodyScrollWidth: document.body.scrollWidth,
      bodyScrollHeight: document.body.scrollHeight
    },
    css: {
      siteHeaderH: rootCs.getPropertyValue("--site-header-h").trim(),
      playerSafe: rootCs.getPropertyValue("--player-safe").trim(),
      pad: rootCs.getPropertyValue("--pad").trim(),
      gap: rootCs.getPropertyValue("--gap").trim(),
      tcH: rootCs.getPropertyValue("--tc-h").trim(),
      gameScale: rootCs.getPropertyValue("--game-scale").trim(),
      appTransform: q(".app") ? getComputedStyle(q(".app")).transform : null
    },
    touchMode: document.body.classList.contains("touch-mode"),
    bodyState: document.body.dataset.state,
    gameStateText: q("#gameState") ? q("#gameState").textContent : null,
    header: {
      present: !!header,
      rect: rect(header),
      position: hcs ? hcs.position : null,
      offsetHeight: header ? header.offsetHeight : null,
      bgImage: hcs ? hcs.backgroundImage : null,
      backdrop: hcs ? (hcs.backdropFilter || hcs.webkitBackdropFilter || "none") : null,
      navLinksCount: header ? header.querySelectorAll(".nav-links a").length : 0,
      navLinksVisible: header ? qa("header .nav-links a").filter(vis).length : 0,
      navLinksText: header ? qa("header .nav-links a").map(function (a) { return a.textContent.trim(); }) : [],
      logoAvatar: {
        exists: !!logoAvatar, visible: vis(logoAvatar), rect: rect(logoAvatar),
        loaded: !!(logoAvatar && logoAvatar.complete && logoAvatar.naturalWidth > 0),
        naturalWidth: logoAvatar ? logoAvatar.naturalWidth : 0
      },
      mobileMenuBtn: {
        exists: !!mmb, visible: vis(mmb), rect: rect(mmb),
        display: mmb ? getComputedStyle(mmb).display : null,
        ariaExpanded: mmb ? mmb.getAttribute("aria-expanded") : null,
        activeClass: mmb ? mmb.classList.contains("active") : false
      },
      muteButton: mute ? {
        exists: true, visible: vis(mute), rect: rect(mute),
        text: mute.textContent.trim(), title: mute.getAttribute("title"), aria: mute.getAttribute("aria-label")
      } : { exists: false },
      toggleSource: toggle ? {
        exists: true, visible: vis(toggle), rect: rect(toggle),
        text: toggle.textContent.trim(), title: toggle.getAttribute("title")
      } : { exists: false }
    },
    navDrawer: {
      mobileOpen: navLinks ? navLinks.classList.contains("mobile-open") : false,
      display: navCs ? navCs.display : null,
      visibility: navCs ? navCs.visibility : null,
      opacity: navCs ? navCs.opacity : null,
      pointerEvents: navCs ? navCs.pointerEvents : null,
      rect: rect(navLinks)
    },
    game: {
      stage: rect(q(".game-stage")),
      app: rect(q(".app")),
      hud: rect(q(".hud")),
      boardWrap: rect(boardWrap),
      board: rect(q("#board")),
      side: rect(q(".side")),
      foot: rect(q(".foot")),
      tc: { exists: !!tc, display: tc ? getComputedStyle(tc).display : null, visible: vis(tc), rect: rect(tc), buttons: tcButtons },
      stageScrollTop: q(".game-stage") ? q(".game-stage").scrollTop : null,
      stageScrollHeight: q(".game-stage") ? q(".game-stage").scrollHeight : null,
      stageClientHeight: q(".game-stage") ? q(".game-stage").clientHeight : null
    },
    overlay: {
      exists: !!overlay,
      hiddenClass: overlay ? overlay.classList.contains("hidden") : null,
      opacity: overlay ? +getComputedStyle(overlay).opacity : null,
      visible: vis(overlay),
      title: q("#ovTitle") ? q("#ovTitle").textContent.trim() : null,
      sub: q("#ovSub") ? q("#ovSub").textContent.trim() : null,
      hint: q("#ovHint") ? q("#ovHint").textContent.trim() : null,
      startBtnText: startBtn ? startBtn.textContent.trim() : null,
      startBtnVisible: vis(startBtn),
      startBtnRect: rect(startBtn)
    },
    controls: {
      pauseBtn: pauseBtn ? { exists: true, disabled: pauseBtn.disabled, classPaused: pauseBtn.classList.contains("is-paused"), visible: vis(pauseBtn), rect: rect(pauseBtn), title: pauseBtn.getAttribute("title") } : { exists: false },
      restartBtn: restartBtn ? { exists: true, disabled: restartBtn.disabled, visible: vis(restartBtn), rect: rect(restartBtn), title: restartBtn.getAttribute("title") } : { exists: false }
    },
    hudText: {
      score: q("#score") ? q("#score").textContent.trim() : null,
      best: q("#best") ? q("#best").textContent.trim() : null,
      lines: q("#lines") ? q("#lines").textContent.trim() : null,
      level: q("#level") ? q("#level").textContent.trim() : null
    },
    canvas: { board: cvInfo(q("#board")), next: cvInfo(q("#next")) },
    audio: {
      exists: !!audio,
      rect: rect(audio),
      visible: vis(audio),
      position: audio ? getComputedStyle(audio).position : null,
      zIndex: audio ? getComputedStyle(audio).zIndex : null,
      musicTitle: q(".music-title") ? q(".music-title").textContent.trim() : null,
      playPauseBtn: !!q("#play-pause-btn"),
      volumeSlider: !!q("#volume-slider"),
      playerInited: !!(window.audioPlayer && window.audioPlayer.isInitialized),
      paused: window.audioPlayer && window.audioPlayer.audio ? window.audioPlayer.audio.paused : null,
      currentFile: window.audioPlayer && window.audioPlayer.audio && window.audioPlayer.audio.src ? String(window.audioPlayer.audio.src).split("/").pop() : null,
      mutedState: window.audioPlayer ? !!window.audioPlayer.isMuted : null
    },
    localStorageBest: (function () { try { return localStorage.getItem("tetris-best"); } catch (e) { return "ERR:" + e.message; } })(),
    localStorageKeys: (function () { try { return Object.keys(localStorage); } catch (e) { return []; } })(),
    activeTag: document.activeElement ? document.activeElement.tagName : null
  };
}

/* ============================ Node 侧工具 ============================ */
async function evalJS(expression) {
  const out = await cdp.send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true, userGesture: true
  });
  if (out.exceptionDetails) {
    const d = out.exceptionDetails;
    const msg = (d.exception && (d.exception.description || d.exception.value)) || d.text;
    throw new Error("页面内执行异常: " + msg);
  }
  return out.result ? out.result.value : undefined;
}

async function snap() {
  const v = await evalJS(`(${pageSnapshot.toString()})()`);
  return v;
}

async function waitFor(expression, timeout = 6000, label = expression) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try {
      last = await evalJS(expression);
      if (last) return last;
    } catch (e) { last = "ERR " + e.message; }
    await sleep(100);
  }
  throw new Error("等待超时(" + timeout + "ms): " + label + "；最后值=" + short(last));
}

async function tryWait(expression, timeout = 6000) {
  try { return await waitFor(expression, timeout, expression); } catch { return false; }
}

async function clickSelector(sel) {
  // 优先「不滚动」直接点：本页 .game-stage 是 overflow:hidden 的滚动容器，
  // 若对内部元素调用 scrollIntoView，会把整个游戏面板上移（非用户真实点击路径），
  // 因此只在元素不在视口内时才退回 scrollIntoView。
  const hit = await evalJS(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    const probe = (r) => {
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      return { x, y, hitSame: !!(top && (top === el || el.contains(top) || top.contains(el))), hitTag: top ? (top.id ? "#" + top.id : top.tagName) : null };
    };
    let r = el.getBoundingClientRect();
    let p = probe(r);
    let scrolled = false;
    if (!p.hitSame) {
      el.scrollIntoView({ block: "center", inline: "center" });
      r = el.getBoundingClientRect();
      p = probe(r);
      scrolled = true;
    }
    return { x: p.x, y: p.y, found: true, hitSame: p.hitSame, hitTag: p.hitTag, scrolled };
  })()`);
  if (!hit) throw new Error("找不到元素: " + sel);
  if (!hit.hitSame) {
    notes.push("click fallback（元素被遮挡或坐标为视口外）: " + sel + "，elementFromPoint=" + hit.hitTag);
    await evalJS(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el) el.click(); return true; })()`);
    await sleep(120);
    return;
  }
  if (hit.scrolled) notes.push("click 前需 scrollIntoView（不在视口内）: " + sel);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hit.x, y: hit.y });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: hit.x, y: hit.y, button: "left", buttons: 1, clickCount: 1
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: hit.x, y: hit.y, button: "left", buttons: 0, clickCount: 1
  });
  await sleep(100);
}

async function pressKey(key, code, vk) {
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  await cdp.send("Input.dispatchKeyEvent", Object.assign({ type: "keyDown" }, base, key === " " ? { text: " " } : {}));
  await cdp.send("Input.dispatchKeyEvent", Object.assign({ type: "keyUp" }, base));
}

async function touchDown(rect) {
  const x = rect.x + rect.w / 2, y = rect.y + rect.h / 2;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 }]
  });
  return { x, y };
}
async function touchUp() {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

const normNum = (s) => {
  const n = parseInt(String(s === null || s === undefined ? "0" : s).replace(/[^0-9]/g, ""), 10);
  return isNaN(n) ? 0 : n;
};

async function setMetrics(width, height, mobile, touch) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 1, mobile: !!mobile,
    screenWidth: width, screenHeight: height
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: !!touch, maxTouchPoints: touch ? 5 : 1
  });
  await sleep(450);
}

async function loadPage(w, h, mobile, touch, query) {
  await setMetrics(w, h, mobile, touch);
  const loaded = cdp.once("Page.loadEventFired");
  await cdp.send("Page.navigate", { url: pathToFileURL(PAGE).href + (query || "") });
  await Promise.race([loaded, sleep(25000)]);
  await tryWait('document.readyState === "complete"', 10000);
  await tryWait('!!document.getElementById("board") && !!document.getElementById("audio-player")', 12000);
  await tryWait('!!(window.audioPlayer && window.audioPlayer.isInitialized)', 8000);
  await sleep(600);
}

function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

async function screenshot(name) {
  await evalJS("window.scrollTo(0, 0)");
  await sleep(300);
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png", fromSurface: true, captureBeyondViewport: false
  });
  const buf = Buffer.from(shot.data, "base64");
  const file = path.join(OUT, name);
  fs.writeFileSync(file, buf);
  const dim = pngSize(buf);
  const rec = { file, bytes: buf.length, dim, viewport: await evalJS("({w:innerWidth,h:innerHeight})") };
  screenshots.push(rec);
  return rec;
}

function overlap(a, b) {
  if (!a || !b) return null;
  const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
  return { w: Math.round(x * 10) / 10, h: Math.round(y * 10) / 10, area: Math.round(x * y) };
}

async function step(sectionId, title, fn) {
  try {
    await fn();
  } catch (e) {
    record(sectionId + ".x", title + "（步骤中断）", false, {
      error: e.message,
      stack: String(e.stack || "").split("\n").slice(0, 4).join(" | ")
    });
  }
}

/* 布局验收：D/P/L 三段共用 */
async function layoutCheck(tag, label) {
  await evalJS("window.scrollTo(0, 0)");
  // 复位所有滚动容器的 scrollTop，避免上一段程序的 scrollIntoView 残留影响测量
  await evalJS(`(() => {
    document.querySelectorAll("*").forEach((el) => { if (el.scrollTop) el.scrollTop = 0; });
    return true;
  })()`);
  await sleep(250);
  const s = await snap();
  const vw = s.viewport.w, vh = s.viewport.h;
  const hb = s.header.rect ? s.header.rect.bottom : null;
  const bw = s.game.boardWrap;
  const gameTop = Math.min(
    ...[s.game.hud && s.game.hud.y, bw && bw.y].filter((v) => typeof v === "number")
  );

  record(tag + "0", label + "：测量时游戏容器未被滚动（.game-stage scrollTop=0、window.scrollY=0）",
    s.game.stageScrollTop === 0 && s.viewport.scrollY === 0,
    { stageScrollTop: s.game.stageScrollTop, windowScrollY: s.viewport.scrollY, stageScrollHeight: s.game.stageScrollHeight, stageClientHeight: s.game.stageClientHeight });

  record(tag + "1", label + "：页面无纵向滚动（documentElement.scrollHeight <= innerHeight+2）",
    s.doc.scrollHeight <= vh + 2,
    { scrollHeight: s.doc.scrollHeight, innerHeight: vh, delta: s.doc.scrollHeight - vh, bodyScrollHeight: s.doc.bodyScrollHeight, clientHeight: s.doc.clientHeight });

  record(tag + "2", label + "：页面无横向滚动（documentElement.scrollWidth <= innerWidth+2）",
    s.doc.scrollWidth <= vw + 2,
    { scrollWidth: s.doc.scrollWidth, innerWidth: vw, delta: s.doc.scrollWidth - vw, bodyScrollWidth: s.doc.bodyScrollWidth });

  record(tag + "3", label + "：header 不遮挡游戏（header 底部 <= 游戏内容顶部）",
    typeof hb === "number" && hb <= gameTop + 1,
    { headerBottom: hb, gameTop, gap: typeof hb === "number" ? Math.round((hb - gameTop) * 10) / 10 : null, hud: s.game.hud, boardWrap: bw, app: s.game.app, gameScale: s.css.gameScale, appTransform: s.css.appTransform, stageScrollTop: s.game.stageScrollTop });

  record(tag + "4", label + "：.board-wrap 完整位于视口内（top>=header 底部、bottom<=innerHeight、左右不出界）",
    !!bw && bw.y >= hb - 1 && bw.y >= -1 && bw.bottom <= vh + 1 && bw.x >= -1 && bw.right <= vw + 1,
    { boardWrap: bw, headerBottom: hb, innerHeight: vh, innerWidth: vw, right: bw && bw.right });

  const ovBoard = overlap(bw, s.audio.rect);
  record(tag + "5", label + "：#audio-player 与 .board-wrap 矩形交集为 0",
    !!ovBoard && ovBoard.area === 0,
    { overlap: ovBoard, boardWrap: bw, audio: s.audio.rect, audioVisible: s.audio.visible });

  if (!s.audio.visible) {
    info(tag + "a", label + "：#audio-player 不可见（矮横屏按设计隐藏底部胶囊，BGM 与 header 静音/切源仍可用）；播放器与棋盘/触屏区交集按 0 判",
      { audioRect: s.audio.rect, audioVisible: s.audio.visible, playerSafe: s.css.playerSafe, gameScale: s.css.gameScale });
  }

  const scrollY = await evalJS("(() => { window.scrollTo(0, 120); const y = window.scrollY; window.scrollTo(0, 0); return y; })()");
  record(tag + "6", label + "：尝试纵向滚动时 scrollY 保持 0（页面不可纵向滚动）",
    scrollY === 0, { scrollYAfterScrollTo120: scrollY });

  if (s.touchMode) {
    const tc = s.game.tc;
    const ovTc = overlap(tc.rect, s.audio.rect);
    record(tag + "7", label + "：触屏模式 #touchControls display=flex、5 个按钮可见",
      s.touchMode && tc.display === "flex" && tc.visible && tc.buttons.length === 5 && tc.buttons.every((b) => b.visible),
      { display: tc.display, visible: tc.visible, count: tc.buttons.length, gameScale: s.css.gameScale, buttons: tc.buttons.map((b) => ({ act: b.act, rect: b.rect })) });
    record(tag + "8", label + "：#audio-player 与 #touchControls 矩形交集为 0（播放器不可见时按 0 计）",
      !!ovTc && ovTc.area === 0,
      { overlap: ovTc, touchControls: tc.rect, audio: s.audio.rect, audioVisible: s.audio.visible });
    record(tag + "9", label + "：触屏按钮中心 elementFromPoint 命中自身（可点、未被遮挡）",
      tc.buttons.length > 0 && tc.buttons.every((b) => b.hitSelf),
      tc.buttons.map((b) => ({ act: b.act, hitSelf: b.hitSelf, hitTag: b.hitTag })));
    const small = tc.buttons.filter((b) => b.rect.w < 44 - 0.5 || b.rect.h < 44 - 0.5);
    if (small.length) {
      info(tag + "s", label + "：等比缩放后触屏按钮视觉尺寸略小于 44px（已知取舍：保证小横屏不滚动/不遮挡，记 INFO 不判 FAIL）",
        { gameScale: s.css.gameScale, small: small.map((b) => ({ act: b.act, w: b.rect.w, h: b.rect.h })) });
    } else {
      info(tag + "s", label + "：触屏按钮视觉尺寸全部 >= 44px", { gameScale: s.css.gameScale, sizes: tc.buttons.map((b) => ({ act: b.act, w: b.rect.w, h: b.rect.h })) });
    }
  } else {
    const tc = s.game.tc;
    record(tag + "7", label + "：非触屏下 #touchControls 隐藏（display=none / 不可见）",
      tc.display === "none" || !tc.visible,
      { display: tc.display, visible: tc.visible });
  }
  return s;
}

async function main() {
  if (!fs.existsSync(PAGE)) throw new Error("验收页面不存在: " + PAGE);
  if (!fs.existsSync(CHROME)) throw new Error("找不到 Chrome: " + CHROME);

  console.log("== 俄罗斯方块页面浏览器验收 ==");
  console.log("页面:", pathToFileURL(PAGE).href);
  console.log("Chrome:", CHROME);
  console.log("截图目录:", OUT);
  console.log("Node:", process.version, "| Chrome profile:", profile);
  const pageStart = pageFingerprint();
  console.log("验收页面指纹:", JSON.stringify(pageStart));

  /* --- 启动 DevTools --- */
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    try { ready = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch { /* 未就绪 */ }
    if (!ready) await sleep(200);
  }
  if (!ready) throw new Error("Chrome DevTools 未就绪（端口 " + PORT + "）");
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = targets.find((t) => t.type === "page");
  if (!target) throw new Error("没有可用的 page target");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  cdp = new CDP(ws);

  cdp.on("Runtime.consoleAPICalled", (p) => {
    const text = (p.args || []).map(fmtArg).join(" ");
    const loc = fmtLoc(p.stackTrace);
    const entry = { kind: "console." + p.type, text, loc };
    if (p.type === "error") consoleErrors.push(entry); else consoleOthers.push(entry);
  });
  cdp.on("Runtime.exceptionThrown", (p) => {
    const d = p.exceptionDetails || {};
    const text = (d.exception && (d.exception.description || d.exception.value)) || d.text || "未知异常";
    pageExceptions.push({ text: String(text), url: (d.url || "") + ":" + ((d.lineNumber || 0) + 1) });
  });
  cdp.on("Log.entryAdded", (p) => {
    const e = p.entry || {};
    const entry = { kind: "log." + (e.source || "?"), level: e.level, text: e.text || "", url: e.url || "" };
    if (e.level === "error") consoleErrors.push(entry); else consoleOthers.push(entry);
  });

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await cdp.send("Page.bringToFront");

  /* =========================================================
   * D 段之前先做桌面加载
   * ========================================================= */
  await loadPage(VIEW_DESKTOP.w, VIEW_DESKTOP.h, false, false, "");

  /* ---------- H. 站点统一 header（桌面） ---------- */
  await step("H", "站点统一 header", async () => {
    const s = await snap();
    record("H1", "<header> 存在且为站点统一的 sticky 玻璃导航（sticky + 渐变 + backdrop blur）",
      s.header.present && s.header.position === "sticky" && /linear-gradient/.test(String(s.header.bgImage)) && String(s.header.backdrop).indexOf("blur") >= 0,
      { present: s.header.present, position: s.header.position, bgImage: s.header.bgImage, backdrop: s.header.backdrop, rect: s.header.rect });
    record("H2", "桌面 7 条导航链接全部可见，文案与顺序符合站点统一 header",
      s.header.navLinksCount === 7 && s.header.navLinksVisible === 7 && JSON.stringify(s.header.navLinksText) === JSON.stringify(EXPECTED_NAV),
      { count: s.header.navLinksCount, visible: s.header.navLinksVisible, text: s.header.navLinksText, expected: EXPECTED_NAV });
    record("H3", "站点 logo 头像存在、可见且图片已加载",
      s.header.logoAvatar.exists && s.header.logoAvatar.visible && s.header.logoAvatar.loaded,
      s.header.logoAvatar);
    record("H4", "header 内静音按钮与切源按钮存在且可见",
      s.header.muteButton.exists && s.header.muteButton.visible && s.header.toggleSource.exists && s.header.toggleSource.visible,
      { mute: s.header.muteButton, toggle: s.header.toggleSource });
    record("H5", "桌面下汉堡菜单按钮隐藏（≥901px 折叠按钮不出现）",
      !s.header.mobileMenuBtn.visible && (s.header.mobileMenuBtn.display === "none" || s.header.mobileMenuBtn.display === null),
      s.header.mobileMenuBtn);
    record("H6", "桌面下 header 不遮挡游戏（header 底部 <= 游戏内容顶部）",
      s.header.rect.bottom <= s.game.hud.y + 1,
      { headerBottom: s.header.rect.bottom, hudTop: s.game.hud.y, boardTop: s.game.boardWrap.y, siteHeaderHCssVar: s.css.siteHeaderH, headerOffsetHeight: s.header.offsetHeight });
    info("H7", "header / CSS 变量实测", {
      headerRect: s.header.rect, offsetHeight: s.header.offsetHeight,
      siteHeaderH: s.css.siteHeaderH, playerSafe: s.css.playerSafe,
      pad: s.css.pad, gap: s.css.gap, tcH: s.css.tcH
    });
  });

  /* ---------- A. 背景音乐 ---------- */
  await step("A", "背景音乐", async () => {
    let s = await snap();
    record("A1", "#audio-player 存在（audioPlayer.js 已初始化并挂载播放器）",
      s.audio.exists && s.audio.playerInited && s.audio.playPauseBtn && s.audio.volumeSlider,
      { exists: s.audio.exists, playerInited: s.audio.playerInited, playPauseBtn: s.audio.playPauseBtn, volumeSlider: s.audio.volumeSlider, rect: s.audio.rect, position: s.audio.position, zIndex: s.audio.zIndex, musicTitle: s.audio.musicTitle, paused: s.audio.paused, source: s.audio.currentFile });
    record("A2", "#audio-player 可见且位于视口内（fixed 底部播放器）",
      s.audio.visible && s.audio.rect.y >= 0 && s.audio.rect.bottom <= s.viewport.h + 1 && s.audio.rect.right <= s.viewport.w + 1,
      { rect: s.audio.rect, visible: s.audio.visible, viewport: s.viewport });
    if (s.audio.paused === true) {
      info("A3", "file:// 下自动播放被浏览器拦截（站点原有行为，记录不判 FAIL）", { paused: s.audio.paused, source: s.audio.currentFile });
    } else {
      info("A3", "file:// 下音频已自动播放（无拦截）", { paused: s.audio.paused, source: s.audio.currentFile });
    }

    /* 静音按钮：真实点击 → 状态变化 */
    const before = s.header.muteButton;
    await clickSelector("#mute-button");
    await sleep(250);
    s = await snap();
    const after = s.header.muteButton;
    const changedFields = [];
    if (after.text !== before.text) changedFields.push("text");
    if (after.title !== before.title) changedFields.push("title");
    if (after.aria !== before.aria) changedFields.push("aria");
    record("A4", "点击 #mute-button 后状态变化（图标/标题/aria 任一变化）",
      changedFields.length > 0,
      { before, after, changedFields, mutedState: s.audio.mutedState });
    // 再点一次恢复
    await clickSelector("#mute-button");
    await sleep(200);
    const restored = (await snap()).header.muteButton;
    info("A5", "再次点击 #mute-button 恢复原状态", { text: restored.text, title: restored.title, mutedState: (await snap()).audio.mutedState });

    /* 切源按钮：真实点击 → 文案变化 */
    const t0 = (await snap()).header.toggleSource.text;
    await clickSelector("#toggle-audio-source");
    await sleep(400);
    const t1 = (await snap()).header.toggleSource.text;
    record("A6", "点击 #toggle-audio-source 切换音频源（按钮文案/音源变化）",
      t0 !== t1,
      { before: t0, after: t1 });
    // 3 个音源依次循环回初始源
    await clickSelector("#toggle-audio-source");
    await sleep(300);
    await clickSelector("#toggle-audio-source");
    await sleep(300);
    const t2 = (await snap()).header.toggleSource.text;
    info("A7", "切源按钮循环 3 次后回到初始音源", { afterThreeClicks: t2, currentFile: (await snap()).audio.currentFile });

    // 自动播放 NotAllowedError 记录（file:// 已知行为）
    const autoPlayMsgs = consoleErrors.concat(consoleOthers).filter((e) => /NotAllowedError|自动播放|play\(\)|autoplay/i.test(e.text));
    if (autoPlayMsgs.length) {
      info("A8", "记录了 file:// 自动播放相关控制台消息（站点原有行为，不判 FAIL）", autoPlayMsgs.slice(0, 4).map((e) => ({ kind: e.kind, text: e.text })));
    } else {
      info("A8", "未观察到自动播放 NotAllowedError 控制台消息（headless 下也可能直接放行）", { paused: (await snap()).audio.paused });
    }
  });

  /* ---------- G. 游戏交互 ---------- */
  await step("G", "游戏交互", async () => {
    let s = await snap();
    record("G1", "初始 body[data-state]=idle，开始遮罩可见，标题「俄罗斯方块」、按钮「开始游戏」",
      s.bodyState === "idle" && s.overlay.visible && s.overlay.hiddenClass === false &&
      s.overlay.title === "俄罗斯方块" && s.overlay.startBtnText === "开始游戏" && s.overlay.startBtnVisible,
      { bodyState: s.bodyState, overlay: s.overlay });
    record("G2", "开始前 #pauseBtn 禁用、#restartBtn 可用",
      s.controls.pauseBtn.exists && s.controls.pauseBtn.disabled === true && s.controls.restartBtn.exists && s.controls.restartBtn.disabled === false,
      { pauseBtn: s.controls.pauseBtn, restartBtn: s.controls.restartBtn });
    info("G3", "初始 HUD / 游戏状态文本", { hud: s.hudText, gameStateText: s.gameStateText, canvas: s.canvas.board, localStorageBest: s.localStorageBest });

    /* 点「开始游戏」 */
    await clickSelector("#startBtn");
    const started = await tryWait('document.body.dataset.state === "running"', 4000);
    await sleep(400);
    s = await snap();
    record("G4", "点 #startBtn → body[data-state]=running、#overlay 隐藏（.hidden + 不可见）",
      !!started && s.bodyState === "running" && s.overlay.hiddenClass === true && s.overlay.visible === false,
      { started, bodyState: s.bodyState, overlay: s.overlay });
    record("G5", "开始后 canvas#board 有绘制内容（toDataURL 长度 > 1000，出现高亮方块像素）",
      s.canvas.board.len > 1000 && !!s.canvas.board.bbox && s.canvas.board.bbox.count > 100,
      { len: s.canvas.board.len, hash: s.canvas.board.hash, colors: s.canvas.board.colors, bbox: s.canvas.board.bbox, pxW: s.canvas.board.pxW, pxH: s.canvas.board.pxH, cssW: s.canvas.board.cssW });
    record("G6", "开始后 #pauseBtn 解除禁用",
      s.controls.pauseBtn.disabled === false, s.controls.pauseBtn);

    /* 键盘：真实 CDP 键盘事件（document 级 keydown 监听） */
    await evalJS("document.activeElement && document.activeElement.blur && document.activeElement.blur()");
    let prev = await snap();
    await pressKey(" ", "Space", 32);
    await sleep(220);
    let cur = await snap();
    const sc0 = normNum(prev.hudText.score), sc1 = normNum(cur.hudText.score);
    record("G7", "键盘「空格」（瞬降）有响应：分数增加且画布像素变化",
      sc1 > sc0 && cur.canvas.board.hash !== prev.canvas.board.hash,
      { scoreBefore: sc0, scoreAfter: sc1, hashBefore: prev.canvas.board.hash, hashAfter: cur.canvas.board.hash, bboxBefore: prev.canvas.board.bbox, bboxAfter: cur.canvas.board.bbox });

    prev = cur;
    await pressKey("ArrowLeft", "ArrowLeft", 37);
    await sleep(160);
    cur = await snap();
    record("G8", "键盘「←」（左移）有响应：画布像素变化",
      cur.canvas.board.hash !== prev.canvas.board.hash,
      { hashBefore: prev.canvas.board.hash, hashAfter: cur.canvas.board.hash, bboxBefore: prev.canvas.board.bbox, bboxAfter: cur.canvas.board.bbox });

    prev = cur;
    await pressKey("ArrowUp", "ArrowUp", 38);
    await sleep(160);
    cur = await snap();
    record("G9", "键盘「↑」（旋转）有响应：画布像素变化",
      cur.canvas.board.hash !== prev.canvas.board.hash,
      { hashBefore: prev.canvas.board.hash, hashAfter: cur.canvas.board.hash, bboxBefore: prev.canvas.board.bbox, bboxAfter: cur.canvas.board.bbox });

    prev = cur;
    await pressKey("ArrowRight", "ArrowRight", 39);
    await sleep(160);
    cur = await snap();
    const rightOk = cur.canvas.board.hash !== prev.canvas.board.hash;
    prev = cur;
    await pressKey("ArrowDown", "ArrowDown", 40);
    await sleep(500);
    cur = await snap();
    const scPrev = normNum(prev.hudText.score), scCur = normNum(cur.hudText.score);
    record("G10", "键盘「→」（右移）与「↓」（软降）有响应：画布像素变化且软降加分",
      rightOk && (cur.canvas.board.hash !== prev.canvas.board.hash || scCur > scPrev),
      { rightCanvasChanged: rightOk, rightHashBefore: prev.canvas.board.hash, rightHashAfter: cur.canvas.board.hash, softDropScoreBefore: scPrev, softDropScoreAfter: scCur, softSumChanged: cur.canvas.board.hash !== prev.canvas.board.hash });

    /* 暂停 / 继续 */
    await clickSelector("#pauseBtn");
    const paused = await tryWait('document.body.dataset.state === "paused"', 3000);
    await sleep(350);
    s = await snap();
    record("G11", "点 #pauseBtn → paused，遮罩显示「已暂停」",
      !!paused && s.bodyState === "paused" && s.overlay.visible && s.overlay.title === "已暂停" && s.controls.pauseBtn.classPaused === true,
      { paused, bodyState: s.bodyState, overlayTitle: s.overlay.title, overlayVisible: s.overlay.visible, pauseBtn: s.controls.pauseBtn, startBtnText: s.overlay.startBtnText });
    await clickSelector("#pauseBtn");
    const resumed = await tryWait('document.body.dataset.state === "running"', 3000);
    await sleep(350);
    s = await snap();
    record("G12", "再点 #pauseBtn → running，遮罩隐藏",
      !!resumed && s.bodyState === "running" && s.overlay.hiddenClass === true && s.overlay.visible === false,
      { resumed, bodyState: s.bodyState, overlay: s.overlay });

    /* 重开：分数归零 */
    await pressKey(" ", "Space", 32);
    await sleep(500);
    s = await snap();
    const scoreBeforeRestart = normNum(s.hudText.score);
    await clickSelector("#restartBtn");
    const restarted = await tryWait('document.body.dataset.state === "running"', 3000);
    await waitFor('String(document.getElementById("score").textContent).replace(/[^0-9]/g,"") === "0"', 3000, "重开后分数归零");
    await sleep(150);
    s = await snap();
    record("G13", "点 #restartBtn → running 且分数归零",
      !!restarted && s.bodyState === "running" && normNum(s.hudText.score) === 0,
      { restarted, bodyState: s.bodyState, scoreBeforeRestart, scoreAfterRestart: s.hudText.score, hud: s.hudText });

    /* 连续瞬降，玩到游戏结束，验证最高分写入 localStorage */
    let over = false;
    for (let i = 0; i < 45 && !over; i++) {
      await pressKey(" ", "Space", 32);
      await sleep(95);
      over = await evalJS('document.body.dataset.state === "over"');
    }
    if (over) await sleep(400);
    s = await snap();
    const bestVal = await evalJS('(() => { try { return localStorage.getItem("tetris-best"); } catch (e) { return "ERR:" + e.message; } })()');
    const bestOk = bestVal !== null && bestVal !== undefined && String(bestVal).trim() !== "" && !/^ERR/.test(String(bestVal));
    if (bestOk) {
      record("G14", "玩一局（连续瞬降直至游戏结束）后 localStorage 写入 tetris-best 最高分",
        true,
        { tetrisBest: bestVal, bestHud: s.hudText.best, gameOverReached: over, bodyState: s.bodyState, overlayTitle: s.overlay.title });
    } else {
      info("G14", "当前 localStorage 未出现 tetris-best（按约定判 INFO：saveBest 只在消行/游戏结束时写入）",
        { tetrisBest: bestVal, localStorageKeys: s.localStorageKeys, gameOverReached: over, bodyState: s.bodyState, score: s.hudText.score });
    }
    info("G15", "连续瞬降结果", { gameOverReached: over, bodyState: s.bodyState, overlayTitle: s.overlay.title, score: s.hudText.score, best: s.hudText.best, lines: s.hudText.lines, bestStored: bestVal });

    /* 重开并玩几秒，作为桌面截图/布局状态 */
    await clickSelector("#restartBtn");
    await tryWait('document.body.dataset.state === "running"', 3000);
    await sleep(300);
    for (let i = 0; i < 7; i++) {
      await pressKey(i % 2 ? "ArrowLeft" : "ArrowRight", i % 2 ? "ArrowLeft" : "ArrowRight", i % 2 ? 37 : 39);
      await sleep(130);
      if (i % 2 === 0) await pressKey("ArrowUp", "ArrowUp", 38);
      await sleep(120);
      await pressKey(" ", "Space", 32);
      await sleep(320);
    }
    await sleep(400);
    s = await snap();
    info("G16", "桌面截图前状态（进行中）", { bodyState: s.bodyState, score: s.hudText.score, lines: s.hudText.lines, level: s.hudText.level, overlayVisible: s.overlay.visible });
  });

  /* ---------- D. 桌面 1500×1000 布局 + 截图 ---------- */
  await step("D", "桌面 1500×1000 布局与截图", async () => {
    const s = await layoutCheck("D", "桌面 1500×1000");
    info("D0", "桌面布局实测矩形", {
      viewport: s.viewport, doc: s.doc, header: s.header.rect, hud: s.game.hud, boardWrap: s.game.boardWrap,
      audio: s.audio.rect, app: s.game.app, stage: s.game.stage, siteHeaderH: s.css.siteHeaderH, playerSafe: s.css.playerSafe, gameScale: s.css.gameScale
    });
    const shot = await screenshot("desktop-1500x1000-playing.png");
    record("D8", "桌面截图已保存（1500×1000 PNG，游戏进行中）",
      shot.bytes > 20000 && !!shot.dim && shot.dim.w === VIEW_DESKTOP.w && shot.dim.h === VIEW_DESKTOP.h,
      { file: shot.file, bytes: shot.bytes, dim: shot.dim, viewport: shot.viewport });
  });

  /* ---------- M/P. 手机竖屏 390×844（touch=1） ---------- */
  await loadPage(VIEW_MOBILE.w, VIEW_MOBILE.h, true, true, "?touch=1");

  await step("M", "手机竖屏 390×844：汉堡菜单", async () => {
    let s = await snap();
    record("M1", "390px：触屏模式生效（body.touch-mode，viewport 390×844）",
      s.touchMode === true && s.viewport.w === VIEW_MOBILE.w && s.viewport.h === VIEW_MOBILE.h,
      { touchMode: s.touchMode, viewport: s.viewport, playerSafe: s.css.playerSafe });
    record("M2", "390px：导航折叠为汉堡菜单（7 条导航不可见、#mobile-menu-btn 可见）",
      s.header.navLinksVisible === 0 && s.header.mobileMenuBtn.visible && s.header.mobileMenuBtn.display === "flex",
      { navLinksCount: s.header.navLinksCount, navLinksVisible: s.header.navLinksVisible, mobileMenuBtn: s.header.mobileMenuBtn, navDrawer: s.navDrawer });

    await clickSelector("#mobile-menu-btn");
    const opened = await tryWait('document.querySelector(".nav-links").classList.contains("mobile-open")', 3000);
    await sleep(400); // 等 .22s 过渡结束
    s = await snap();
    record("M3", "点 #mobile-menu-btn 后 .nav-links 带 mobile-open，抽屉可见（visibility=visible、opacity≈1）",
      !!opened && s.navDrawer.mobileOpen === true && s.navDrawer.visibility === "visible" && parseFloat(s.navDrawer.opacity) >= 0.9 && s.header.navLinksVisible === 7,
      { opened, navDrawer: s.navDrawer, navLinksVisible: s.header.navLinksVisible });
    record("M4", "汉堡按钮 aria-expanded 同步为 true 且带 .active 类",
      s.header.mobileMenuBtn.ariaExpanded === "true" && s.header.mobileMenuBtn.activeClass === true,
      s.header.mobileMenuBtn);

    // 关闭抽屉，避免影响后续布局测量
    await clickSelector("#mobile-menu-btn");
    await sleep(400);
    s = await snap();
    record("M5", "再次点击汉堡按钮收起抽屉（mobile-open 移除、aria-expanded=false）",
      s.navDrawer.mobileOpen === false && s.header.mobileMenuBtn.ariaExpanded === "false",
      { navDrawer: s.navDrawer, ariaExpanded: s.header.mobileMenuBtn.ariaExpanded });
  });

  await step("T", "手机竖屏：触屏操作按钮真实点击", async () => {
    let s = await snap();
    // 点开始
    await clickSelector("#startBtn");
    const started = await tryWait('document.body.dataset.state === "running"', 4000);
    await sleep(350);
    s = await snap();
    record("T1", "390px 触屏：点 #startBtn → running、遮罩隐藏、触屏操作区可见",
      !!started && s.bodyState === "running" && s.overlay.hiddenClass === true && s.game.tc.display === "flex" && s.game.tc.visible,
      { started, bodyState: s.bodyState, overlayHidden: s.overlay.hiddenClass, tc: { display: s.game.tc.display, visible: s.game.tc.visible, rect: s.game.tc.rect, count: s.game.tc.buttons.length } });

    // 触屏「左移」：pointerdown → .is-on + 画布变化
    const leftBtn = s.game.tc.buttons.find((b) => b.act === "left");
    if (!leftBtn) throw new Error("找不到触屏「左移」按钮");
    const hashBefore = s.canvas.board.hash;
    await touchDown(leftBtn.rect);
    await sleep(90);
    const mid = await snap();
    const isOnMid = !!mid.game.tc.buttons.find((b) => b.act === "left" && b.isOn === true);
    await touchUp();
    await sleep(180);
    const after = await snap();
    record("T2", "触屏「左移」按钮可点：pointerdown 后按钮高亮 .is-on，棋盘像素随之变化",
      isOnMid && after.canvas.board.hash !== hashBefore,
      { isOnDuringTouch: isOnMid, hashBefore, hashAfter: after.canvas.board.hash, bboxBefore: s.canvas.board.bbox, bboxAfter: after.canvas.board.bbox, isOnAfterRelease: !!after.game.tc.buttons.find((b) => b.act === "left" && b.isOn === true) });

    // 触屏「瞬降」：pointerdown → 分数增加
    const dropBtn = after.game.tc.buttons.find((b) => b.act === "drop");
    const scoreBefore = normNum(after.hudText.score);
    await touchDown(dropBtn.rect);
    await sleep(140);
    await touchUp();
    await sleep(500);
    const end = await snap();
    record("T3", "触屏「瞬降」按钮可点：点击后分数增加",
      normNum(end.hudText.score) > scoreBefore,
      { scoreBefore, scoreAfter: end.hudText.score, scoreBeforeNum: scoreBefore, scoreAfterNum: normNum(end.hudText.score) });

    // 再玩两下，让截图里棋盘有堆叠
    for (let i = 0; i < 2; i++) {
      const d = (await snap()).game.tc.buttons.find((b) => b.act === "drop");
      await touchDown(d.rect);
      await sleep(120);
      await touchUp();
      await sleep(420);
    }
  });

  await step("P", "手机竖屏 390×844 布局与截图", async () => {
    const s = await layoutCheck("P", "手机竖屏 390×844");
    info("P0", "手机竖屏布局实测矩形", {
      viewport: s.viewport, doc: s.doc, header: s.header.rect, hud: s.game.hud, boardWrap: s.game.boardWrap,
      audio: s.audio.rect, audioVisible: s.audio.visible, touchControls: s.game.tc.rect, app: s.game.app, stage: s.game.stage,
      siteHeaderH: s.css.siteHeaderH, playerSafe: s.css.playerSafe, tcH: s.css.tcH, gameScale: s.css.gameScale
    });
    const sizes = s.game.tc.buttons.map((b) => ({ act: b.act, w: b.rect.w, h: b.rect.h }));
    record("P10", "手机竖屏 390×844：触屏按钮视觉尺寸 >= 44px（--game-scale=" + (s.css.gameScale || "1") + "，期望不缩放）",
      sizes.length === 5 && sizes.every((b) => b.w >= 44 - 0.5 && b.h >= 44 - 0.5),
      { gameScale: s.css.gameScale, sizes });
    const shot = await screenshot("mobile-portrait-390x844-playing.png");
    record("P11", "手机竖屏截图已保存（390×844 PNG，游戏进行中）",
      shot.bytes > 20000 && !!shot.dim && shot.dim.w === VIEW_MOBILE.w && shot.dim.h === VIEW_MOBILE.h,
      { file: shot.file, bytes: shot.bytes, dim: shot.dim, viewport: shot.viewport });
  });

  /* ---------- L. 手机横屏 844×390（touch=1） ---------- */
  await loadPage(VIEW_LANDSCAPE.w, VIEW_LANDSCAPE.h, true, true, "?touch=1");

  await step("L", "手机横屏 844×390 布局与截图", async () => {
    let s = await snap();
    record("L0", "844×390 横屏 + touch=1：触屏模式生效（body.touch-mode）",
      s.touchMode === true && s.viewport.w === VIEW_LANDSCAPE.w && s.viewport.h === VIEW_LANDSCAPE.h,
      { touchMode: s.touchMode, viewport: s.viewport, playerSafe: s.css.playerSafe });
    // 开始游戏，截图为进行中
    await clickSelector("#startBtn");
    await tryWait('document.body.dataset.state === "running"', 4000);
    await sleep(300);
    for (let i = 0; i < 3; i++) {
      await pressKey(" ", "Space", 32);
      await sleep(300);
    }
    const ls = await layoutCheck("L", "手机横屏 844×390");
    info("L0b", "手机横屏布局实测矩形", {
      viewport: ls.viewport, doc: ls.doc, header: ls.header.rect, hud: ls.game.hud, boardWrap: ls.game.boardWrap,
      audio: ls.audio.rect, audioVisible: ls.audio.visible, touchControls: ls.game.tc.rect, app: ls.game.app, stage: ls.game.stage, side: ls.game.side,
      siteHeaderH: ls.css.siteHeaderH, playerSafe: ls.css.playerSafe, gameScale: ls.css.gameScale, appTransform: ls.css.appTransform
    });
    record("L10", "手机横屏 844×390：按设计隐藏底部 #audio-player 胶囊（display:none / 不可见），BGM 元素仍初始化；header 静音/切源按钮经汉堡菜单可达",
      !ls.audio.visible && ls.audio.playerInited && ls.header.muteButton.exists && ls.header.toggleSource.exists,
      { audio: ls.audio, muteButton: ls.header.muteButton, toggleSource: ls.header.toggleSource });
    // 844px ≤ 900px：header 控制按钮在抽屉里，展开汉堡菜单验证仍可点（真实点击）
    await clickSelector("#mobile-menu-btn");
    const drawerOpen = await tryWait('document.querySelector(".nav-links").classList.contains("mobile-open")', 3000);
    await sleep(400);
    const ds = await snap();
    const drawerControlsOk = !!(drawerOpen && ds.header.muteButton.visible && ds.header.toggleSource.visible);
    record("L10c", "手机横屏：展开汉堡菜单后 header 静音/切源按钮可见可点（真实点击菜单按钮）",
      drawerControlsOk,
      { drawerOpen, muteButton: ds.header.muteButton, toggleSource: ds.header.toggleSource, navDrawer: ds.navDrawer });
    // 顺手验证抽屉里的静音按钮真实可点
    if (drawerControlsOk) {
      const muteBefore = ds.header.muteButton.text;
      await clickSelector("#mute-button");
      await sleep(250);
      const ms = await snap();
      record("L10d", "手机横屏：抽屉内 #mute-button 真实点击后状态变化",
        ms.header.muteButton.text !== muteBefore,
        { before: muteBefore, after: ms.header.muteButton.text });
      await clickSelector("#mute-button");
      await sleep(200);
    }
    // 关闭抽屉，恢复截图状态
    if (await evalJS('document.querySelector(".nav-links").classList.contains("mobile-open")')) {
      await clickSelector("#mobile-menu-btn");
      await sleep(400);
    }
    // 隐性风险测试：程序性 scrollIntoView / 焦点滚动会不会把 overflow:hidden 的 .game-stage 上滚
    const latent = await evalJS(`(() => {
      const stage = document.querySelector('.game-stage');
      const app = document.querySelector('.app');
      const before = stage.scrollTop;
      const btn = document.getElementById('startBtn');
      btn.scrollIntoView({ block: 'center' });
      const afterScrollIntoView = stage.scrollTop;
      const appTopAfterSIV = Math.round(app.getBoundingClientRect().top * 10) / 10;
      stage.scrollTop = 0;
      document.getElementById('pauseBtn').focus();
      const afterFocus = stage.scrollTop;
      const appTopAfterFocus = Math.round(app.getBoundingClientRect().top * 10) / 10;
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      stage.scrollTop = 0;
      return {
        before, afterScrollIntoView, appTopAfterSIV, afterFocus, appTopAfterFocus,
        stageScrollHeight: stage.scrollHeight, stageClientHeight: stage.clientHeight,
        appTopRestored: Math.round(app.getBoundingClientRect().top * 10) / 10
      };
    })()`);
    if (latent.afterScrollIntoView !== 0 || latent.afterFocus !== 0) {
      info("L10e", "潜在风险（非用户常规点击路径）：横屏 .game-stage 是 overflow:hidden 滚动容器且内容布局高度超出可视区，程序性 scrollIntoView / 焦点滚动会把面板上移，HUD 可能被 header 覆盖。正常点击不受影响，L3 在 scrollTop=0 的正常状态下测量。", latent);
    } else {
      info("L10e", "横屏 .game-stage 未被程序性 scrollIntoView / 焦点滚动上移（scrollTop 保持 0）", latent);
    }
    await sleep(200);
    info("L10i", "横屏设计取舍：底部播放器胶囊隐藏，BGM（audio 元素）与 header 静音/切源按钮仍可用；播放器与棋盘/触屏区交集按 0 判", {
      audioVisible: ls.audio.visible, audioPaused: ls.audio.paused, playerInited: ls.audio.playerInited, playerSafe: ls.css.playerSafe
    });
    const sizes = ls.game.tc.buttons.map((b) => ({ act: b.act, w: b.rect.w, h: b.rect.h }));
    record("L10b", "手机横屏 844×390：触屏按钮可点（5 个按钮中心命中自身）",
      ls.game.tc.buttons.length === 5 && ls.game.tc.buttons.every((b) => b.hitSelf && b.visible),
      { gameScale: ls.css.gameScale, sizes, buttons: ls.game.tc.buttons.map((b) => ({ act: b.act, hitSelf: b.hitSelf, isOn: b.isOn })) });
    const shot = await screenshot("mobile-landscape-844x390-playing.png");
    record("L11", "手机横屏截图已保存（844×390 PNG，游戏进行中）",
      shot.bytes > 15000 && !!shot.dim && shot.dim.w === VIEW_LANDSCAPE.w && shot.dim.h === VIEW_LANDSCAPE.h,
      { file: shot.file, bytes: shot.bytes, dim: shot.dim, viewport: shot.viewport });
  });

  /* ---------- C. 控制台 ---------- */
  await step("C", "控制台", async () => {
    const unclassifiedExceptions = pageExceptions.filter((e) => !classifyConsole(e.text));
    const knownExceptions = pageExceptions.filter((e) => classifyConsole(e.text));
    record("C1", "无未捕获控制器异常（Runtime.exceptionThrown；file:// 音频自动播放等已知项除外）",
      unclassifiedExceptions.length === 0,
      { unclassified: unclassifiedExceptions, total: pageExceptions.length });
    if (knownExceptions.length) info("C1i", "已分类的未捕获异常（站点原有 file:// 行为，不判 FAIL）", knownExceptions);
    const unclassifiedConsole = consoleErrors.filter((e) => !classifyConsole(e.text));
    const knownConsole = consoleErrors.filter((e) => classifyConsole(e.text));
    record("C2", "控制台无未分类错误（console.error / Log error；file:// 音频自动播放、manifest 等已知项除外）",
      unclassifiedConsole.length === 0,
      { unclassified: unclassifiedConsole, totalErrors: consoleErrors.length, unclassifiedCount: unclassifiedConsole.length });
    for (const e of knownConsole) {
      info("C3", "已分类控制台错误（站点原有 file:// 行为，不判 FAIL）", { kind: e.kind, text: e.text, loc: e.loc || e.url || "", classify: classifyConsole(e.text) });
    }
    for (const e of consoleOthers) {
      info("C4", "控制台非错误消息", { kind: e.kind, text: e.text, loc: e.loc || e.url || "" });
    }
    info("C5", "控制台统计", { errors: consoleErrors.length, others: consoleOthers.length, exceptions: pageExceptions.length });
  });

  /* ---------- F. 验收版本指纹 ---------- */
  await step("F", "验收版本指纹", async () => {
    const end = pageFingerprint();
    const FROZEN_TETRIS = "16870DEC0A7EB03BB9D93273ABE34345A45448DE5BCABD21790C8F448D8B7A7C";
    record("F1", "验收期间页面文件未再变动（开始/结束 sha256、字节数一致）",
      end.sha256 === pageStart.sha256 && end.bytes === pageStart.bytes,
      { start: pageStart, end });
    record("F2", "验收页面 sha256 与 Lead 冻结版本一致",
      end.sha256.toUpperCase() === FROZEN_TETRIS,
      { actual: end.sha256, expected: FROZEN_TETRIS });
    info("F3", "验收页面指纹（file://）", { sha256: end.sha256, bytes: end.bytes, mtime: end.mtime, frozenExpected: FROZEN_TETRIS });
  });

  /* ============================ 汇总 ============================ */
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;

  console.log("\n=== PASS/FAIL 清单 ===");
  for (const r of results) {
    console.log(`${r.ok ? "[PASS]" : "[FAIL]"} ${r.id} ${r.title}`);
    if (!r.ok && r.evidence !== undefined) console.log(`        证据: ${short(r.evidence)}`);
  }

  console.log("\n=== 截图（绝对路径） ===");
  for (const s of screenshots) {
    console.log(`${s.file}  ${s.dim ? s.dim.w + "x" + s.dim.h : "?"}  ${Math.round(s.bytes / 1024)}KB`);
  }
  if (notes.length) {
    console.log("\n=== 测试备注 ===");
    for (const n of notes) console.log("- " + n);
  }
  console.log("\n=== 控制台 ===");
  if (!consoleErrors.length && !consoleOthers.length && !pageExceptions.length) console.log("（无控制台消息）");
  for (const e of consoleErrors) {
    const known = classifyConsole(e.text);
    console.log(`[error] ${e.text} ${e.loc || e.url || ""}${known ? "  ⟵ 已知：" + known : "  ⟵ 未分类"}`);
  }
  for (const e of pageExceptions) {
    const known = classifyConsole(e.text);
    console.log(`[exception] ${e.text} ${e.url || ""}${known ? "  ⟵ 已知：" + known : "  ⟵ 未分类"}`);
  }
  for (const e of consoleOthers) console.log(`[${(e.kind || "console").replace(/^console\./, "").replace(/^log\./, "log ")}] ${e.text} ${e.loc || e.url || ""}`);

  console.log("\n=== 发现的问题 ===");
  const fails = results.filter((r) => !r.ok);
  if (!fails.length) console.log("（无 FAIL）");
  for (const r of fails) {
    console.log(`- [${r.id}] ${r.title}`);
    if (r.evidence !== undefined) console.log("  证据: " + short(r.evidence));
  }

  console.log("\n=== 验收页面指纹（验收结束时） ===");
  const pageEnd = pageFingerprint();
  console.log(`sha256=${pageEnd.sha256}  bytes=${pageEnd.bytes}  mtime=${pageEnd.mtime}`);
  console.log("Lead 冻结版本: 16870DEC0A7EB03BB9D93273ABE34345A45448DE5BCABD21790C8F448D8B7A7C  → " +
    (pageEnd.sha256.toUpperCase() === "16870DEC0A7EB03BB9D93273ABE34345A45448DE5BCABD21790C8F448D8B7A7C" ? "MATCH" : "MISMATCH"));

  console.log("\n=== 汇总 ===");
  console.log(`PASS ${pass} / FAIL ${fail} / INFO ${infos.length} / 截图 ${screenshots.length}`);
  console.log("\nRESULT: " + (fail ? "FAIL" : "PASS"));

  try { ws.close(); } catch { /* 忽略 */ }
  process.exitCode = fail ? 1 : 0;
}

main()
  .catch((e) => {
    console.error("\n验收脚本致命错误:", e && e.stack ? e.stack : e);
    process.exitCode = 3;
  })
  .finally(async () => {
    try { chrome.kill(); } catch { /* 忽略 */ }
    await sleep(400);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 */ }
  });
