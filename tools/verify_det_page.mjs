/**
 * 行列式计算器页面浏览器验收（本机 Chrome + CDP，无第三方依赖）
 *
 * 用法:
 *   node tools/verify_det_page.mjs [repoRoot] [outDir]
 *
 * 默认 repoRoot = 当前目录, outDir = <系统临时目录>/det-shots
 *
 * 覆盖：
 *   加载/控制台错误、KaTeX 渲染、动漫背景、默认 -3、示例、变量代入、
 *   清空、2–6 阶边界、6 阶计算、非法输入红框恢复、复制按钮、桌面/手机布局截图。
 *
 * 只读取页面，不修改任何站点文件；截图仅写入 outDir。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CHROME = process.env.CHROME ||
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const ROOT = path.resolve(process.argv[2] || process.cwd());
const OUT = path.resolve(process.argv[3] || path.join(os.tmpdir(), "det-shots"));
const PAGE = path.join(ROOT, "docs", "determinant.html");
const PORT = 9500 + Math.floor(Math.random() * 400);
const SHOT_WIDTH_DESKTOP = 1500;
const SHOT_WIDTH_MOBILE = 390;

fs.mkdirSync(OUT, { recursive: true });

/* ============================ 报告 ============================ */
const results = [];
const infos = [];
const notes = [];

function record(id, title, ok, evidence) {
  ok = !!ok;
  results.push({ ok, id, title, evidence });
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${id} ${title}`);
  if (!ok && evidence !== undefined) console.log(`        证据: ${short(evidence)}`);
}
function info(id, title, detail) {
  infos.push({ id, title, detail });
  console.log(`[INFO] ${id} ${title}${detail !== undefined ? " — " + short(detail) : ""}`);
}
function short(v) {
  let s;
  try { s = typeof v === "string" ? v : JSON.stringify(v); } catch { s = String(v); }
  if (s === undefined) s = String(v);
  return s.length > 800 ? s.slice(0, 800) + "…" : s;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================ CDP ============================ */
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "det-verify-"));
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-proxy-server", "--no-first-run",
  "--disable-extensions", "--allow-file-access-from-files",
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

/* 控制台 / 页面异常收集 */
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

/* 已知的 file:// 站点原有行为（记录，不判 FAIL） */
const KNOWN_CONSOLE = [
  { re: /site\.webmanifest|webmanifest/i, label: "站点原有：file:// 下 site.webmanifest CORS" },
  { re: /NotAllowedError|play\(\)|autoplay|自动播放|音频|audio/i, label: "站点原有：file:// 下音频自动播放/加载受限" }
];
function classifyConsole(text) {
  for (const k of KNOWN_CONSOLE) if (k.re.test(text)) return k.label;
  return null;
}
function classifyException(text) {
  for (const k of KNOWN_CONSOLE) if (k.re.test(text)) return k.label;
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
  var rect = function (n) {
    if (!n) return null;
    var r = n.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
  };
  var styleOf = function (n) {
    if (!n) return null;
    var cs = getComputedStyle(n);
    return {
      bg: cs.backgroundColor,
      bgImage: cs.backgroundImage,
      color: cs.color,
      borderTopWidth: cs.borderTopWidth,
      borderTopColor: cs.borderTopColor,
      borderRadius: cs.borderTopLeftRadius,
      boxShadow: cs.boxShadow,
      backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter || "none",
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      opacity: cs.opacity
    };
  };
  var lum = function (color) {
    var m = String(color).match(/[0-9.]+/g);
    if (!m || m.length < 3) return null;
    var f = function (v) { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(+m[0]) + 0.7152 * f(+m[1]) + 0.0722 * f(+m[2]);
  };
  var contrast = function (fg, bg) {
    var a = lum(fg), b = lum(bg);
    if (a === null || b === null) return null;
    return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
  };
  var opaqueBg = function (n) {
    var node = n;
    while (node && node !== document.documentElement) {
      var c = getComputedStyle(node).backgroundColor;
      var m = String(c).match(/[0-9.]+/g);
      if (m && (m.length < 4 || +m[3] >= 0.9)) return c;
      node = node.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  var textInfo = function (sel) {
    var n = q(sel);
    if (!n) return null;
    var cs = getComputedStyle(n);
    var bg = opaqueBg(n);
    return {
      sel: sel, color: cs.color, bg: bg,
      contrast: contrast(cs.color, bg),
      fontSize: cs.fontSize, visible: vis(n)
    };
  };
  var btnInfo = function (sel) {
    var n = q(sel);
    if (!n) return null;
    return { sel: sel, rect: rect(n), visible: vis(n), text: (n.textContent || "").trim(), fontSize: getComputedStyle(n).fontSize };
  };
  var bg = (function () {
    var layers = qa(".background-layer");
    var loaded = layers.filter(function (l) { return String(getComputedStyle(l).backgroundImage).indexOf("url(") >= 0; });
    var maxOpacity = 0;
    for (var i = 0; i < layers.length; i++) {
      var op = parseFloat(getComputedStyle(layers[i]).opacity);
      if (!isNaN(op) && op > maxOpacity) maxOpacity = op;
    }
    var container = q(".background-container");
    return {
      bodyBgImage: getComputedStyle(document.body).backgroundImage,
      bodyBgColor: getComputedStyle(document.body).backgroundColor,
      beforeBgColor: getComputedStyle(document.body, "::before").backgroundColor,
      containerPresent: !!container,
      containerZIndex: container ? getComputedStyle(container).zIndex : null,
      layerCount: layers.length,
      loadedCount: loaded.length,
      loadedImages: loaded.slice(0, 2).map(function (l) { return String(getComputedStyle(l).backgroundImage); }),
      maxOpacity: maxOpacity
    };
  })();
  var flatViolations = qa(".tool, .tool *").filter(function (n) {
    if (n.closest && n.closest(".katex")) return false;
    var cs = getComputedStyle(n);
    var bf = cs.backdropFilter || cs.webkitBackdropFilter || "none";
    return cs.backgroundImage !== "none" || bf !== "none";
  }).map(function (n) {
    var cs = getComputedStyle(n);
    return (typeof n.className === "string" && n.className.trim() ? "." + n.className.trim().split(/\s+/).join(".") : n.tagName) +
      " bgImage=" + cs.backgroundImage + " backdrop=" + (cs.backdropFilter || cs.webkitBackdropFilter || "none");
  });
  var shadowViolations = qa(".tool, .tool *").filter(function (n) {
    if (n.closest && n.closest(".katex")) return false;
    if (n === document.activeElement) return false;
    return getComputedStyle(n).boxShadow !== "none";
  }).map(function (n) {
    return (typeof n.className === "string" && n.className.trim() ? "." + n.className.trim().split(/\s+/).join(".") : n.tagName) +
      " boxShadow=" + getComputedStyle(n).boxShadow;
  });
  var state = window.DetPage ? window.DetPage.getState() : null;
  var result = window.DetPage ? window.DetPage.getResult() : null;
  var cells = qa(".matrix-cell");
  return {
    ready: !!(window.DetEngine && window.DetPage && cells.length > 0),
    detEngineVersion: window.DetEngine ? window.DetEngine.version : null,
    activeTag: document.activeElement ? document.activeElement.tagName : null,
    n: state ? state.n : null,
    sizeText: q("#matrix-size") ? q("#matrix-size").textContent : null,
    cellValues: cells.map(function (c) { return c.value; }),
    cellCount: cells.length,
    stateCells: state ? state.cells : null,
    result: result ? {
      mode: result.mode,
      resultText: result.resultText,
      resultLatex: typeof result.resultLatex === "string" ? result.resultLatex : "",
      variables: result.variables,
      exact: result.exact,
      decimalText: result.decimalText,
      scientificText: result.scientificText,
      formulaText: result.formulaText,
      constant: result.constant,
      warnings: result.warnings || []
    } : null,
    badge: { text: q("#mode-badge") ? q("#mode-badge").textContent : null, visible: vis(q("#mode-badge")) },
    resultBodyVisible: vis(q("#result-body")),
    resultEmpty: { visible: vis(q("#result-empty")), text: q("#result-empty") ? q("#result-empty").textContent.trim() : null },
    error: (function () {
      var n = q("#error-box");
      if (!n) return null;
      var cs = getComputedStyle(n);
      return {
        visible: vis(n), text: n.textContent.trim(),
        color: cs.color, bg: cs.backgroundColor, borderColor: cs.borderColor,
        role: n.getAttribute("role")
      };
    })(),
    resultDisplay: (function () {
      var n = q("#result-display");
      var k = n ? n.querySelector(".katex") : null;
      return {
        katexCount: n ? n.querySelectorAll(".katex").length : 0,
        text: n ? n.innerText.trim() : null,
        rect: rect(n),
        visible: vis(n),
        katexFontSize: k ? getComputedStyle(k).fontSize : null,
        color: n ? getComputedStyle(n).color : null,
        bg: n ? getComputedStyle(n).backgroundColor : null
      };
    })(),
    preview: (function () {
      var n = q("#matrix-preview");
      return {
        katexCount: n ? n.querySelectorAll(".katex").length : 0,
        text: n ? n.innerText.trim() : null,
        rect: rect(n),
        visible: vis(n)
      };
    })(),
    katexErrorCount: qa(".katex-error").length,
    invalidCells: qa(".matrix-cell.invalid").map(function (c) {
      var cs = getComputedStyle(c);
      return { r: c.dataset.r, c: c.dataset.c, borderColor: cs.borderColor, bg: cs.backgroundColor };
    }),
    substitute: (function () {
      var sec = q("#substitute-section");
      var res = q("#substitute-result");
      return {
        visible: vis(sec),
        hidden: sec ? sec.hidden : null,
        rect: rect(sec),
        inputs: qa("#var-inputs input").map(function (i) { return { name: i.dataset.var, value: i.value }; }),
        resultVisible: vis(res),
        resultText: res ? res.innerText.trim() : "",
        resultHtmlLength: res ? res.innerHTML.length : 0
      };
    })(),
    meta: qa("#result-meta .meta-row").map(function (r) {
      var l = r.querySelector(".meta-label");
      var v = r.querySelector(".meta-value");
      return { label: l ? l.textContent.trim() : "", value: v ? v.innerText.trim() : "" };
    }),
    copyHint: q("#copy-hint") ? q("#copy-hint").textContent.trim() : null,
    sizes: {
      decDisabled: q("#size-dec") ? q("#size-dec").disabled : null,
      incDisabled: q("#size-inc") ? q("#size-inc").disabled : null
    },
    layout: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      cols: qa(".layout .col").map(rect),
      cardCount: qa(".layout .card").length,
      toolRect: rect(q(".tool")),
      introRect: rect(q(".intro"))
    },
    chrome: (function () {
      var header = q("header");
      var footer = q("footer");
      var hs = header ? getComputedStyle(header) : null;
      var fs2 = footer ? getComputedStyle(footer) : null;
      return {
        headerPresent: !!header,
        headerRect: rect(header),
        headerBgImage: hs ? hs.backgroundImage : null,
        headerBackdrop: hs ? (hs.backdropFilter || hs.webkitBackdropFilter || "none") : null,
        headerPosition: hs ? hs.position : null,
        navLinkCount: qa("header .nav-links a").length,
        navLinksVisible: qa("header .nav-links a").filter(vis).length,
        mobileMenuVisible: vis(q("#mobile-menu-btn")),
        footerPresent: !!footer,
        footerRect: rect(footer),
        footerBgColor: fs2 ? fs2.backgroundColor : null,
        footerColor: fs2 ? fs2.color : null
      };
    })(),
    bg: bg,
    styles: {
      pageH1: styleOf(q(".intro h1")),
      card: styleOf(q(".layout .card")),
      intro: styleOf(q(".intro")),
      primaryBtn: styleOf(q("#calc-btn")),
      secondaryBtn: styleOf(q("#clear-btn")),
      exampleBtn: styleOf(q(".example-btn")),
      badge: styleOf(q("#mode-badge")),
      result: styleOf(q("#result-display")),
      preview: styleOf(q("#matrix-preview"))
    },
    flatViolations: flatViolations,
    shadowViolations: shadowViolations,
    texts: {
      h1: textInfo(".intro h1"),
      lede: textInfo(".lede"),
      cardH2: textInfo(".card-head h2"),
      cell: textInfo(".matrix-cell"),
      primaryBtn: textInfo("#calc-btn"),
      exampleBtn: textInfo(".example-btn"),
      metaValue: textInfo(".meta-value"),
      metaLabel: textInfo(".meta-label"),
      hint: textInfo(".hint")
    },
    buttons: [
      btnInfo("#calc-btn"), btnInfo("#clear-btn"), btnInfo("#size-dec"), btnInfo("#size-inc"),
      btnInfo(".example-btn"), btnInfo("#copy-latex"), btnInfo("#copy-text"), btnInfo("#substitute-btn")
    ].filter(Boolean)
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
  await evalJS("document.activeElement && document.activeElement.blur && document.activeElement.blur()");
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
  try { await waitFor(expression, timeout, expression); return true; } catch { return false; }
}

async function clickSelector(sel) {
  const hit = await evalJS(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    return { x, y, found: true, hitSame: !!(top && (top === el || el.contains(top) || top.contains(el))) };
  })()`);
  if (!hit) throw new Error("找不到元素: " + sel);
  if (!hit.hitSame) {
    notes.push("click fallback（元素被遮挡或坐标为视口外）: " + sel);
    await evalJS(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el) el.click(); return true; })()`);
    await sleep(120);
    return;
  }
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hit.x, y: hit.y });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: hit.x, y: hit.y, button: "left", buttons: 1, clickCount: 1
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: hit.x, y: hit.y, button: "left", buttons: 0, clickCount: 1
  });
  await sleep(90);
}

async function typeValue(sel, text) {
  await clickSelector(sel);
  const focused = await evalJS(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return false;
    el.focus();
    if (el.select) el.select();
    return true;
  })()`);
  if (!focused) throw new Error("找不到输入框: " + sel);
  await cdp.send("Input.insertText", { text });
  await sleep(60);
  const value = await evalJS(`document.querySelector(${JSON.stringify(sel)}).value`);
  if (value !== text) {
    notes.push("Input.insertText 未生效，回退为原生 setter + input 事件: " + sel);
    await evalJS(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(el, ${JSON.stringify(text)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await sleep(60);
  }
}

const norm = (s) => String(s || "").replace(/[\u2212\u2013\u2014]/g, "-").replace(/\s+/g, "");

async function setMetrics(width, height, mobile) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 1, mobile: !!mobile,
    screenWidth: width, screenHeight: height
  });
  if (mobile) {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  } else {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
  await sleep(450);
}

function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

async function screenshot(name, width) {
  await evalJS("window.scrollTo(0, 0)");
  await sleep(300);
  const docH = await evalJS("document.documentElement.scrollHeight");
  const h = Math.min(Math.max(docH, 200), 30000);
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png", captureBeyondViewport: true, fromSurface: true,
    clip: { x: 0, y: 0, width, height: h, scale: 1 }
  });
  const buf = Buffer.from(shot.data, "base64");
  const file = path.join(OUT, name);
  fs.writeFileSync(file, buf);
  const dim = pngSize(buf);
  return { file, bytes: buf.length, dim, requestedHeight: h };
}

async function step(sectionId, title, fn) {
  try {
    await fn();
  } catch (e) {
    record(sectionId + ".x", title + "（步骤中断）", false, { error: e.message, stack: String(e.stack || "").split("\n").slice(0, 4).join(" | ") });
  }
}

/* ============================ 主流程 ============================ */
async function main() {
  if (!fs.existsSync(PAGE)) throw new Error("验收页面不存在: " + PAGE);
  if (!fs.existsSync(CHROME)) throw new Error("找不到 Chrome: " + CHROME);
  console.log("== 行列式计算器浏览器验收 ==");
  console.log("页面:", pathToFileURL(PAGE).href);
  console.log("Chrome:", CHROME);
  console.log("截图目录:", OUT);
  console.log("Node:", process.version, "| Chrome profile:", profile);

  // 启动 DevTools
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
    pageExceptions.push({ text, url: (d.url || "") + ":" + ((d.lineNumber || 0) + 1) });
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
  await setMetrics(SHOT_WIDTH_DESKTOP, 1000, false);

  // 导航
  const loaded = cdp.once("Page.loadEventFired");
  await cdp.send("Page.navigate", { url: pathToFileURL(PAGE).href });
  await Promise.race([loaded, sleep(25000)]);
  await tryWait('document.readyState === "complete"', 10000);
  await tryWait('!!(window.DetEngine && window.DetPage && document.querySelectorAll(".matrix-cell").length === 9)', 15000);
  await tryWait('!!document.querySelector("#matrix-preview .katex") && !!document.querySelector("#result-display .katex")', 12000);
  await tryWait('!!document.querySelector(".background-layer") && Array.prototype.some.call(document.querySelectorAll(".background-layer"), l => getComputedStyle(l).backgroundImage.indexOf("url(") >= 0)', 12000);
  await sleep(900);
  // 等待 KaTeX 字体（file:// 下可能被 CORS 拦住，仅记录）
  try {
    await Promise.race([
      evalJS('document.fonts && document.fonts.ready ? document.fonts.ready.then(() => document.fonts.status) : "n/a"'),
      sleep(5000)
    ]);
  } catch { /* 字体等待失败不致命 */ }

  /* ---------- 1. 加载 / 控制台 ---------- */
  await step("1", "页面加载", async () => {
    const s = await snap();
    record("1.1", "页面初始化完成：DetEngine/DetPage 就绪，默认 9 个矩阵输入格", s.ready && s.cellCount === 9, {
      ready: s.ready, cellCount: s.cellCount, detEngineVersion: s.detEngineVersion
    });
    record("1.2", "无未捕获页面异常（window onerror / uncaught exception）", pageExceptions.length === 0, pageExceptions);
    const unclassifiedExceptions = pageExceptions.filter((e) => !classifyException(e.text));
    record("1.3", "无未分类的未捕获异常（已知 file:// 音频/清单行为除外）", unclassifiedExceptions.length === 0, unclassifiedExceptions);
    const unexpectedConsole = consoleErrors.filter((e) => !classifyConsole(e.text));
    record("1.4", "无未分类控制台错误（manifest CORS / audio play 已知项已记录）", unexpectedConsole.length === 0, {
      unexpected: unexpectedConsole,
      known: consoleErrors.filter((e) => classifyConsole(e.text)).map((e) => ({ text: e.text, 分类: classifyConsole(e.text) }))
    });
    record("1.5", "KaTeX 渲染成功：矩阵预览与结果区都有 .katex，且无 .katex-error", s.preview.katexCount > 0 && s.resultDisplay.katexCount > 0 && s.katexErrorCount === 0, {
      previewKatex: s.preview.katexCount, resultKatex: s.resultDisplay.katexCount, katexError: s.katexErrorCount
    });
    record("1.6", "动漫背景存在：backgroundLoader 背景图层已加载图片（动画背景）", s.bg.containerPresent && s.bg.layerCount >= 1 && s.bg.loadedCount >= 1 && s.bg.maxOpacity > 0, s.bg);
    info("1.7", "body 的 backgroundImage = " + JSON.stringify(s.bg.bodyBgImage) + "；实际动漫背景由 .background-container/.background-layer 提供（站点原有机制），body 另有 ::before 半透明遮罩 " + JSON.stringify(s.bg.beforeBgColor));
    for (const [label, list] of [["控制台 error", consoleErrors], ["控制台 warning/其他", consoleOthers], ["页面异常", pageExceptions]]) {
      for (const e of list) info("console", label, (e.kind ? "[" + e.kind + "] " : "") + e.text + " " + (e.loc || e.url || "") + (classifyConsole(e.text) ? " ⟵ " + classifyConsole(e.text) : ""));
    }
  });

  /* ---------- 2. 默认状态 ---------- */
  await step("2", "默认状态", async () => {
    const s = await snap();
    const expect = ["1", "2", "3", "4", "5", "6", "7", "8", "10"];
    const stateFlat = s.stateCells ? s.stateCells.flat() : null;
    record("2.1", "默认 3 阶数值矩阵：9 格且内容为示例 [[1,2,3],[4,5,6],[7,8,10]]", s.n === 3 && s.sizeText === "3" && JSON.stringify(s.cellValues) === JSON.stringify(expect) && JSON.stringify(stateFlat) === JSON.stringify(expect), {
      n: s.n, sizeText: s.sizeText, cells: s.cellValues, stateCells: stateFlat
    });
    record("2.2", "默认结果 -3（精确模式）", !!(s.result && s.result.mode === "exact" && s.result.resultText === "-3"), s.result && { mode: s.result.mode, resultText: s.result.resultText });
    record("2.3", "角标显示「数值 · 精确」且可见", s.badge.text === "数值 · 精确" && s.badge.visible, s.badge);
    record("2.4", "结果区可见、初始提示隐藏，结果 KaTeX 文本包含 -3", s.resultBodyVisible === true && s.resultEmpty.visible === false && s.resultDisplay.katexCount > 0 && norm(s.resultDisplay.text).indexOf("-3") >= 0, {
      resultBodyVisible: s.resultBodyVisible, resultEmpty: s.resultEmpty, displayText: s.resultDisplay.text, katex: s.resultDisplay.katexCount
    });
    record("2.5", "默认整数结果 -3 不堆叠冗余元信息（新页面设计：整数精确结果只放大显示；分数/小数/科学计数法见 3.15/3.16）", s.meta.length === 0, s.meta);
    record("2.6", "矩阵预览渲染 KaTeX 且内容非空", s.preview.katexCount >= 1 && !!s.preview.text, { katex: s.preview.katexCount, text: s.preview.text });
  });

  /* ---------- 3. 示例与变量代入 ---------- */
  await step("3", "示例与变量代入", async () => {
    await clickSelector('.example-btn[data-example="symbolic"]');
    await waitFor('window.DetPage && window.DetPage.getResult() && window.DetPage.getResult().mode === "symbolic"', 6000, "符号 2×2 结果");
    let s = await snap();
    record("3.1", "点「符号 2×2」→ 结果 a*d - b*c（mode=symbolic）", s.n === 2 && !!(s.result && s.result.mode === "symbolic" && norm(s.result.resultText) === "a*d-b*c"), {
      n: s.n, result: s.result && { mode: s.result.mode, resultText: s.result.resultText }, badge: s.badge
    });
    record("3.2", "符号结果的角标为「代数公式」且结果区渲染 KaTeX", s.badge.text === "代数公式" && s.badge.visible && s.resultDisplay.katexCount > 0, { badge: s.badge, katex: s.resultDisplay.katexCount });
    record("3.3", "变量代入卡出现且可见，有 4 个输入框（a/b/c/d，默认值为 1）", s.substitute.visible === true && s.substitute.inputs.length === 4 && JSON.stringify(s.substitute.inputs.map((i) => i.name)) === JSON.stringify(["a", "b", "c", "d"]) && s.substitute.inputs.every((i) => i.value === "1"), s.substitute);
    await typeValue('#var-inputs input[data-var="a"]', "1");
    await typeValue('#var-inputs input[data-var="b"]', "2");
    await typeValue('#var-inputs input[data-var="c"]', "3");
    await typeValue('#var-inputs input[data-var="d"]', "4");
    await clickSelector("#substitute-btn");
    await waitFor('(() => { const n = document.getElementById("substitute-result"); return n && !n.hidden && n.innerText.trim().length > 0; })()', 6000, "代入结果出现");
    s = await snap();
    record("3.4", "代入 a=1,b=2,c=3,d=4 点「代入计算」→ 出现 -2", s.substitute.resultVisible && norm(s.substitute.resultText).indexOf("-2") >= 0 && s.substitute.resultText.indexOf("精确值") >= 0, {
      text: s.substitute.resultText, inputs: s.substitute.inputs
    });

    // 范德蒙德 4×4
    await clickSelector('.example-btn[data-example="vandermonde"]');
    await waitFor('window.DetPage && window.DetPage.getResult() && window.DetPage.getResult().mode === "symbolic"', 8000, "范德蒙德符号结果");
    s = await snap();
    record("3.5", "点「范德蒙德 4×4」→ 4 阶矩阵 + 代数公式（变量 a,b,c,d，结果非空且渲染 KaTeX）", s.n === 4 && !!(s.result && s.result.mode === "symbolic") && JSON.stringify(s.result.variables) === JSON.stringify(["a", "b", "c", "d"]) && (s.result.resultText || "").length > 5 && s.resultDisplay.katexCount > 0, {
      n: s.n, mode: s.result && s.result.mode, vars: s.result && s.result.variables, resultLength: s.result && (s.result.resultText || "").length, resultText: s.result && s.result.resultText && s.result.resultText.slice(0, 160)
    });
    record("3.6", "范德蒙德 → 变量代入卡出现（4 个输入框）", s.substitute.visible && s.substitute.inputs.length === 4, s.substitute);
    await typeValue('#var-inputs input[data-var="a"]', "1");
    await typeValue('#var-inputs input[data-var="b"]', "2");
    await typeValue('#var-inputs input[data-var="c"]', "3");
    await typeValue('#var-inputs input[data-var="d"]', "4");
    await clickSelector("#substitute-btn");
    await waitFor('(() => { const n = document.getElementById("substitute-result"); return n && !n.hidden && n.innerText.trim().length > 0; })()', 6000, "范德蒙德代入结果");
    s = await snap();
    record("3.7", "范德蒙德代入 a=1,b=2,c=3,d=4 → 12", s.substitute.resultVisible && /(^|[^0-9])12([^0-9]|$)/.test(norm(s.substitute.resultText)), { text: s.substitute.resultText });

    // 特征多项式 3×3
    await clickSelector('.example-btn[data-example="charpoly"]');
    await waitFor('window.DetPage && window.DetPage.getResult() && window.DetPage.getResult().mode === "symbolic"', 6000, "特征多项式结果");
    s = await snap();
    record("3.8", "点「特征多项式 3×3」→ 3 阶、代数公式、变量含 x、代入卡 1 个输入框", s.n === 3 && !!(s.result && s.result.mode === "symbolic") && (s.result.variables || []).indexOf("x") >= 0 && norm(s.result.resultText).indexOf("x^3") >= 0 && s.substitute.visible && s.substitute.inputs.length === 1, {
      resultText: s.result && s.result.resultText, vars: s.result && s.result.variables, sub: s.substitute
    });
    await typeValue('#var-inputs input[data-var="x"]', "1");
    await clickSelector("#substitute-btn");
    await waitFor('(() => { const n = document.getElementById("substitute-result"); return n && !n.hidden && n.innerText.trim().length > 0; })()', 6000, "特征多项式代入结果");
    s = await snap();
    record("3.9", "特征多项式代入 x=1 → 5", s.substitute.resultVisible && /(^|[^0-9])5([^0-9]|$)/.test(norm(s.substitute.resultText)), { text: s.substitute.resultText });

    // 上三角 3×3
    await clickSelector('.example-btn[data-example="triangular"]');
    await waitFor('window.DetPage && window.DetPage.getResult() && window.DetPage.getResult().mode === "symbolic"', 6000, "上三角结果");
    s = await snap();
    record("3.10", "点「上三角 3×3」→ 结果 a*d*f（矩阵变量 a,b,c,d,f 均进入代入卡，e 按常量处理）", s.n === 3 && !!(s.result && norm(s.result.resultText) === "a*d*f") && ["a", "d", "f"].every((v) => (s.result.variables || []).indexOf(v) >= 0) && s.substitute.visible && s.substitute.inputs.length === 5 && ["a", "d", "f"].every((v) => s.substitute.inputs.some((i) => i.name === v)), {
      resultText: s.result && s.result.resultText, vars: s.result && s.result.variables, sub: s.substitute
    });
    await typeValue('#var-inputs input[data-var="a"]', "2");
    await typeValue('#var-inputs input[data-var="d"]', "3");
    await typeValue('#var-inputs input[data-var="f"]', "4");
    await clickSelector("#substitute-btn");
    await waitFor('(() => { const n = document.getElementById("substitute-result"); return n && !n.hidden && n.innerText.trim().length > 0; })()', 6000, "上三角代入结果");
    s = await snap();
    record("3.11", "上三角代入 a=2,d=3,f=4 → 24", s.substitute.resultVisible && /(^|[^0-9])24([^0-9]|$)/.test(norm(s.substitute.resultText)), { text: s.substitute.resultText });

    // 三角 2×2（含函数）
    await clickSelector('.example-btn[data-example="trig"]');
    await waitFor('window.DetPage && window.DetPage.getResult() && window.DetPage.getResult().mode === "symbolic"', 6000, "三角结果");
    s = await snap();
    record("3.12", "点「三角 2×2」→ 含函数项代数公式、变量 x、有「未做三角恒等式化简」类警告、KaTeX 正常", s.n === 2 && !!(s.result && s.result.mode === "symbolic") && (s.result.variables || []).indexOf("x") >= 0 && (s.result.warnings || []).length >= 1 && s.resultDisplay.katexCount > 0, {
      resultText: s.result && s.result.resultText, warnings: s.result && s.result.warnings
    });

    // 随机 4×4
    await clickSelector('.example-btn[data-example="random"]');
    await waitFor('window.DetPage && window.DetPage.getResult() && window.DetPage.getResult().mode === "exact"', 6000, "随机结果");
    s = await snap();
    record("3.13", "点「随机 4×4」→ 4 阶数值精确结果（无错误、结果区可见、角标「数值 · 精确」）", s.n === 4 && !!(s.result && s.result.mode === "exact" && /^-?\d+$/.test(s.result.resultText)) && s.resultBodyVisible && s.badge.text === "数值 · 精确" && !(s.error && s.error.visible), {
      cells: s.cellValues, resultText: s.result && s.result.resultText, badge: s.badge
    });

    // 回到数值 3×3
    await clickSelector('.example-btn[data-example="numeric"]');
    await waitFor('window.DetPage && window.DetPage.getResult() && window.DetPage.getResult().resultText === "-3"', 6000, "数值示例 -3");
    s = await snap();
    record("3.14", "点「数值 3×3」→ 恢复到 -3 精确结果", s.n === 3 && !!(s.result && s.result.mode === "exact" && s.result.resultText === "-3") && s.badge.text === "数值 · 精确", { resultText: s.result && s.result.resultText });

    // 结果格式：精确分数 / 小数 / 科学计数法（全部走真实 DOM 输入）
    await clickSelector("#clear-btn");
    await clickSelector("#size-dec"); // 3 → 2 阶
    await sleep(300);
    await typeValue('.matrix-cell[data-r="0"][data-c="0"]', "1/3");
    await typeValue('.matrix-cell[data-r="0"][data-c="1"]', "0");
    await typeValue('.matrix-cell[data-r="1"][data-c="0"]', "0");
    await typeValue('.matrix-cell[data-r="1"][data-c="1"]', "1");
    await waitFor('window.DetPage && window.DetPage.getResult() && window.DetPage.getResult().resultText === "1/3"', 8000, "2×2 分数 1/3 结果");
    s = await snap();
    const labels1 = s.meta.map((m) => m.label);
    record("3.15", "2×2 输入分数 1/3 → 精确结果 1/3，元信息出现「精确值」「小数」行", s.result.mode === "exact" && s.result.resultText === "1/3" && labels1.indexOf("精确值") >= 0 && labels1.indexOf("小数") >= 0, {
      result: s.result && { mode: s.result.mode, resultText: s.result.resultText, decimalText: s.result.decimalText },
      meta: s.meta
    });
    await typeValue('.matrix-cell[data-r="0"][data-c="0"]', "1e-7");
    await waitFor('window.DetPage && window.DetPage.getResult() && window.DetPage.getResult().resultText === "1/10000000"', 8000, "2×2 科学计数法 1e-7 结果");
    s = await snap();
    const labels2 = s.meta.map((m) => m.label);
    record("3.16", "2×2 输入科学计数法 1e-7 → 精确结果 1/10000000，元信息出现「科学计数法」行", s.result.mode === "exact" && s.result.resultText === "1/10000000" && labels2.indexOf("精确值") >= 0 && labels2.indexOf("科学计数法") >= 0 && !!s.result.scientificText, {
      result: s.result && { mode: s.result.mode, resultText: s.result.resultText, decimalText: s.result.decimalText, scientificText: s.result.scientificText },
      meta: s.meta
    });
    // 恢复默认数值 3×3，供后续清空/阶数测试
    await clickSelector('.example-btn[data-example="numeric"]');
    await waitFor('window.DetPage && window.DetPage.getResult() && window.DetPage.getResult().resultText === "-3"', 6000, "恢复数值 3×3");
  });

  /* ---------- 4. 清空 ---------- */
  await step("4", "清空", async () => {
    await clickSelector("#clear-btn");
    await sleep(250);
    const s = await snap();
    record("4.1", "点「清空」→ 全部单元格为空（DOM 与内部状态）", s.cellValues.length === 9 && s.cellValues.every((v) => v === "") && s.stateCells.flat().every((v) => v === ""), {
      cells: s.cellValues, state: s.stateCells
    });
    record("4.2", "清空后结果区回到提示态：结果 body 隐藏、提示可见、角标隐藏、变量代入卡隐藏", s.resultBodyVisible === false && s.resultEmpty.visible === true && s.badge.visible === false && s.substitute.visible === false, {
      resultBody: s.resultBodyVisible, resultEmpty: s.resultEmpty, badge: s.badge, substituteVisible: s.substitute.visible
    });
    record("4.3", "清空后预览回到空提示（无 KaTeX 残留）", s.preview.text.indexOf("输入矩阵后在这里预览") >= 0 && s.preview.katexCount === 0, { text: s.preview.text, katex: s.preview.katexCount });
  });

  /* ---------- 5. 阶数 2–6 ---------- */
  await step("5", "阶数边界与 6 阶计算", async () => {
    // 当前 n=3（清空后仍为 3）
    await clickSelector("#size-dec");
    await sleep(300);
    let s = await snap();
    record("5.1", "点「−」→ 降到 2 阶，且「−」按钮禁用", s.n === 2 && s.sizeText === "2" && s.sizes.decDisabled === true && s.cellCount === 4, { n: s.n, sizeText: s.sizeText, sizes: s.sizes, cells: s.cellCount });
    await clickSelector("#size-dec");
    await sleep(300);
    s = await snap();
    record("5.2", "2 阶时再点「−」无效（仍为 2 阶）", s.n === 2 && s.sizes.decDisabled === true, { n: s.n, sizes: s.sizes });
    const sizeIds = ["5.3", "5.4", "5.5", "5.6"];
    for (let n = 3; n <= 6; n++) {
      await clickSelector("#size-inc");
      await sleep(320);
      s = await snap();
      record(sizeIds[n - 3], "点「+」→ 阶数 " + n + "，输入格 " + (n * n) + " 个", s.n === n && s.sizeText === String(n) && s.cellCount === n * n, { n: s.n, sizeText: s.sizeText, cells: s.cellCount });
    }
    s = await snap();
    record("5.7", "6 阶时「+」禁用、「−」可用", s.n === 6 && s.sizes.incDisabled === true && s.sizes.decDisabled === false, { n: s.n, sizes: s.sizes });
    // 6 阶填对角 1..6，det = 720
    for (let i = 0; i < 6; i++) {
      await typeValue(`.matrix-cell[data-r="${i}"][data-c="${i}"]`, String(i + 1));
    }
    await sleep(700);
    await waitFor('window.DetPage && window.DetPage.getResult() && window.DetPage.getResult().resultText === "720"', 8000, "6 阶 det=720");
    s = await snap();
    record("5.8", "6 阶矩阵（对角 1..6）可算出结果 720（精确模式、结果 KaTeX 正常）", s.n === 6 && !!(s.result && s.result.mode === "exact" && s.result.resultText === "720") && s.resultDisplay.katexCount > 0 && s.badge.text === "数值 · 精确", {
      resultText: s.result && s.result.resultText, mode: s.result && s.result.mode, katex: s.resultDisplay.katexCount, cells: s.cellValues
    });
  });

  /* ---------- 6. 非法输入 ---------- */
  await step("6", "非法输入与恢复", async () => {
    await clickSelector('.example-btn[data-example="numeric"]');
    await waitFor('window.DetPage && window.DetPage.getResult() && window.DetPage.getResult().resultText === "-3"', 6000, "数值示例恢复 -3");
    await typeValue('.matrix-cell[data-r="0"][data-c="0"]', "a+");
    await waitFor('(() => { const n = document.getElementById("error-box"); return n && !n.hidden; })()', 6000, "错误框出现");
    await sleep(400); // 等边框颜色 transition(.15s) 结束
    let s = await snap();
    record("6.1", "单元格输入非法表达式 a+ → 显示红色错误框（含行列号提示）", s.error.visible === true && s.error.text.length > 0 && /第 1 行第 1 列/.test(s.error.text), { error: s.error });
    record("6.2", "错误框为红色系：文字 rgb(185,28,28)、背景 rgb(254,242,242)", s.error.color === "rgb(185, 28, 28)" && s.error.bg === "rgb(254, 242, 242)", { color: s.error.color, bg: s.error.bg });
    record("6.3", "出错单元格高亮：.invalid + 红色边框 rgb(220,38,38) + 浅红底 rgb(254,242,242)", s.invalidCells.length === 1 && s.invalidCells[0].r === "0" && s.invalidCells[0].c === "0" && s.invalidCells[0].borderColor === "rgb(220, 38, 38)" && s.invalidCells[0].bg === "rgb(254, 242, 242)", s.invalidCells);
    record("6.4", "出错时结果区隐藏、角标隐藏、预览显示语法错误提示", s.resultBodyVisible === false && s.resultEmpty.visible === true && s.badge.visible === false && s.preview.text.indexOf("语法错误") >= 0, {
      resultBody: s.resultBodyVisible, resultEmpty: s.resultEmpty, badge: s.badge, preview: s.preview.text, error: s.error && s.error.text
    });
    // 修复
    await typeValue('.matrix-cell[data-r="0"][data-c="0"]', "1");
    await waitFor('window.DetPage && window.DetPage.getResult() && window.DetPage.getResult().resultText === "-3"', 8000, "修复后恢复 -3");
    s = await snap();
    record("6.5", "改回合法值后恢复：错误框消失、高亮消除、结果 -3 恢复", s.error.visible === false && s.invalidCells.length === 0 && s.resultBodyVisible === true && s.result.resultText === "-3", {
      error: s.error, invalid: s.invalidCells, resultText: s.result && s.result.resultText
    });
    // 对应单元格映射：第 2 行第 3 列输入 b+
    await typeValue('.matrix-cell[data-r="1"][data-c="2"]', "b+");
    await waitFor('(() => { const n = document.getElementById("error-box"); return n && !n.hidden; })()', 6000, "中间格错误框");
    await sleep(400);
    s = await snap();
    record("6.6", "非法输入在中间单元格时，对应单元格（第 2 行第 3 列）高亮", s.invalidCells.length === 1 && s.invalidCells[0].r === "1" && s.invalidCells[0].c === "2" && /第 2 行第 3 列/.test(s.error.text), {
      invalid: s.invalidCells, error: s.error && s.error.text
    });
    await typeValue('.matrix-cell[data-r="1"][data-c="2"]', "6");
    await waitFor('window.DetPage && window.DetPage.getResult() && window.DetPage.getResult().resultText === "-3"', 8000, "再次恢复 -3");
    s = await snap();
    record("6.7", "再次改回合法值后错误完全恢复（错误隐藏、非法标记清空、结果区可见）", s.error.visible === false && s.invalidCells.length === 0 && s.resultBodyVisible === true, {
      error: s.error, invalid: s.invalidCells, resultBody: s.resultBodyVisible
    });
  });

  /* ---------- 7. 复制按钮 ---------- */
  await step("7", "复制按钮", async () => {
    await clickSelector("#copy-latex");
    const appeared = await tryWait('(() => { const n = document.getElementById("copy-hint"); return n && n.textContent.trim().length > 0; })()', 4000);
    const s = await snap();
    info("7.1", "点「复制 LaTeX」的实际行为（file:// 下 clipboard 不判 FAIL）", {
      hintAppeared: appeared,
      hintText: s.copyHint,
      reading: s.copyHint === "LaTeX 已复制" ? "剪贴板写入成功" : (s.copyHint ? "剪贴板被拒，走了失败提示" : "未出现任何提示")
    });
    record("7.2", "点「复制 LaTeX」后有可见反馈（成功或失败提示都算，clipboard 权限见 INFO）", appeared === true && !!s.copyHint, { hint: s.copyHint });
    // 另测「复制结果」，同样只记录
    await clickSelector("#copy-text");
    const appeared2 = await tryWait('(() => { const n = document.getElementById("copy-hint"); return n && n.textContent.trim().length > 0; })()', 4000);
    const s2 = await snap();
    info("7.3", "点「复制结果」的实际行为", { hintAppeared: appeared2, hintText: s2.copyHint });
  });

  /* ---------- 8. 桌面视觉 1500×1000 ---------- */
  await step("8", "桌面视觉 1500×1000", async () => {
    await setMetrics(SHOT_WIDTH_DESKTOP, 1000, false);
    // 用内容较丰富的范德蒙德 + 代入结果作为截图状态
    await clickSelector('.example-btn[data-example="vandermonde"]');
    await waitFor('window.DetPage && window.DetPage.getResult() && window.DetPage.getResult().mode === "symbolic"', 8000, "桌面截图用范德蒙德");
    await typeValue('#var-inputs input[data-var="a"]', "1");
    await typeValue('#var-inputs input[data-var="b"]', "2");
    await typeValue('#var-inputs input[data-var="c"]', "3");
    await typeValue('#var-inputs input[data-var="d"]', "4");
    await clickSelector("#substitute-btn");
    await tryWait('(() => { const n = document.getElementById("substitute-result"); return n && !n.hidden; })()', 5000);
    await evalJS("window.scrollTo(0, 0)");
    await sleep(500);
    let s = await snap();

    record("8.1", "桌面 1500px：无横向溢出（scrollWidth <= innerWidth + 2）", s.layout.scrollWidth <= s.layout.innerWidth + 2, {
      scrollWidth: s.layout.scrollWidth, innerWidth: s.layout.innerWidth, bodyScrollWidth: s.layout.bodyScrollWidth
    });
    const cols = s.layout.cols;
    const overlap = cols.length === 2
      ? Math.max(0, Math.min(cols[0].right, cols[1].right) - Math.max(cols[0].x, cols[1].x)) *
        Math.max(0, Math.min(cols[0].bottom, cols[1].bottom) - Math.max(cols[0].y, cols[1].y))
      : -1;
    record("8.2", "桌面：左列卡片与右列卡片并排、互不重叠、都在视口内", cols.length === 2 && overlap === 0 && cols[0].right <= cols[1].x + 2 && cols[1].right <= s.layout.innerWidth + 2, {
      cols, overlap, innerWidth: s.layout.innerWidth
    });
    const card = s.styles.card;
    record("8.3", "扁平白卡：白底不透明、1px 灰边、无渐变/无阴影/无毛玻璃", card && card.bg === "rgb(255, 255, 255)" && card.borderTopWidth === "1px" && card.bgImage === "none" && card.boxShadow === "none" && (card.backdropFilter === "none") && s.flatViolations.length === 0 && s.shadowViolations.length === 0, {
      card, flatViolations: s.flatViolations.slice(0, 6), shadowViolations: s.shadowViolations.slice(0, 6)
    });
    const primary = s.styles.primaryBtn;
    record("8.4", "强调色为单一蓝色 #2563eb（计算按钮纯色、无渐变）", primary && primary.bg === "rgb(37, 99, 235)" && primary.bgImage === "none", primary);
    record("8.5", "结果区非空且清晰：结果 KaTeX 字号 >= 18px、结果区高度 >= 60px、文本非空", s.resultDisplay.katexCount > 0 && parseFloat(s.resultDisplay.katexFontSize) >= 18 && s.resultDisplay.rect.h >= 60 && norm(s.resultDisplay.text).length > 0, {
      katexFontSize: s.resultDisplay.katexFontSize, resultRect: s.resultDisplay.rect, text: s.resultDisplay.text
    });
    record("8.6", "公式与预览清晰：预览区高度 >= 60px、KaTeX 存在、预览文本非空", s.preview.katexCount > 0 && s.preview.rect.h >= 60 && norm(s.preview.text).length > 0, {
      previewRect: s.preview.rect, katex: s.preview.katexCount
    });
    const badBtns = s.buttons.filter((b) => b.visible && b.rect.w > 0 && (b.rect.w < 24 || b.rect.h < 24 || b.rect.right > s.layout.innerWidth + 2 || b.rect.w === 0));
    record("8.7", "按钮清晰可点：可见按钮尺寸 >= 24×24px 且未被横向裁切", badBtns.length === 0, badBtns);
    const functional = ["h1", "lede", "cardH2", "cell", "primaryBtn", "exampleBtn", "metaValue", "metaLabel"];
    const contrasts = functional.map((k) => ({ key: k, ...(s.texts[k] || {}) })).filter((t) => t.contrast !== null && t.contrast !== undefined);
    const lowContrast = contrasts.filter((t) => t.contrast < 4.5);
    record("8.8", "扁平卡片在动漫背景上可读：正文/标题/控件文字对比度 >= 4.5（白卡不透明）", lowContrast.length === 0, {
      lowContrast, contrasts: contrasts.map((t) => ({ key: t.key, contrast: t.contrast, color: t.color, bg: t.bg }))
    });
    record("8.9", "动漫背景与内容层级正常：背景图层 z-index 为负、卡片不透明覆盖背景但背景可见", s.bg.containerPresent && s.bg.layerCount >= 1 && s.bg.loadedCount >= 1 && s.bg.maxOpacity > 0 && card.bg === "rgb(255, 255, 255)", s.bg);
    info("8.10", "桌面背景记录", { bodyBgImage: s.bg.bodyBgImage, layers: s.bg.layerCount, loaded: s.bg.loadedCount, maxOpacity: s.bg.maxOpacity, loadedImages: s.bg.loadedImages });
    record("8.11", "站点外壳保留：深色玻璃导航（sticky + 渐变背景 + backdrop blur）与紫色页脚可见、桌面导航 7 项可见", s.chrome.headerPresent && /linear-gradient/.test(String(s.chrome.headerBgImage)) && String(s.chrome.headerBackdrop).indexOf("blur") >= 0 && s.chrome.headerPosition === "sticky" && s.chrome.footerPresent && /133, 39, 210/.test(String(s.chrome.footerBgColor)) && s.chrome.navLinksVisible === 7, s.chrome);

    // 长公式（范德蒙德展开式）在固定宽度结果框内的滚动/裁切测量
    const clip = await evalJS(`(() => {
      const box = document.getElementById("result-display");
      if (!box || !box.firstElementChild) return null;
      const inner = box.firstElementChild;
      const b = box.getBoundingClientRect();
      const cs = getComputedStyle(box);
      const before = box.scrollLeft;
      box.scrollLeft = 0;
      const leftAt0 = inner.getBoundingClientRect().left - b.left;
      box.scrollLeft = -1e6;
      const minScroll = box.scrollLeft;
      const leftAfterMin = inner.getBoundingClientRect().left - b.left;
      box.scrollLeft = before;
      return {
        clientWidth: box.clientWidth,
        scrollWidth: box.scrollWidth,
        innerWidth: Math.round(inner.getBoundingClientRect().width),
        canScroll: box.scrollWidth > box.clientWidth + 1,
        overflowX: cs.overflowX,
        justifyContent: cs.justifyContent,
        innerLeftAtScroll0: Math.round(leftAt0),
        minScrollLeft: minScroll,
        innerLeftAfterMinScroll: Math.round(leftAfterMin)
      };
    })()`);
    info("8.12", "长公式（范德蒙德 4×4 展开式）在结果框内的横向滚动/裁切测量", clip);
    record("8.13", "长公式不撑破卡片/页面：结果框 overflow-x 为 auto、页面无横向溢出", s.layout.scrollWidth <= s.layout.innerWidth + 2 && !!clip && (!clip.canScroll || clip.overflowX === "auto" || clip.overflowX === "scroll"), { clip, scrollWidth: s.layout.scrollWidth, innerWidth: s.layout.innerWidth });
    if (clip && clip.canScroll && clip.innerLeftAfterMinScroll < -1) {
      notes.push("发现：长公式（范德蒙德 4×4 展开式）在结果框内被 flex 居中 + overflow-x:auto 裁掉了左侧（innerLeft=" + clip.innerLeftAfterMinScroll + "px，scrollLeft 最小只能到 " + clip.minScrollLeft + "），开头 \\det A = 及部分项无法通过横向滚动看到；见 8.12 测量。");
    }

    const shot = await screenshot("desktop-1500x1000.png", SHOT_WIDTH_DESKTOP);
    record("8.14", "桌面整页截图已保存（1500×整页高度 PNG，非空）", shot.bytes > 30000 && shot.dim && shot.dim.w === SHOT_WIDTH_DESKTOP && shot.dim.h === shot.requestedHeight, shot);
    info("截图", "桌面截图", shot.file + "  " + JSON.stringify(shot.dim) + "  " + Math.round(shot.bytes / 1024) + "KB");
  });

  /* ---------- 9. 手机视觉 390×844 ---------- */
  await step("9", "手机视觉 390×844", async () => {
    await setMetrics(SHOT_WIDTH_MOBILE, 844, true);
    await evalJS("window.scrollTo(0, 0)");
    await sleep(600);
    let s = await snap();
    record("9.1", "手机 390px：无横向溢出（scrollWidth <= innerWidth + 2）", s.layout.scrollWidth <= s.layout.innerWidth + 2, {
      scrollWidth: s.layout.scrollWidth, innerWidth: s.layout.innerWidth, bodyScrollWidth: s.layout.bodyScrollWidth
    });
    const cols = s.layout.cols;
    const stacked = cols.length === 2 && Math.abs(cols[0].x - cols[1].x) <= 1 && cols[1].y >= cols[0].bottom - 1;
    const overlap = cols.length === 2
      ? Math.max(0, Math.min(cols[0].right, cols[1].right) - Math.max(cols[0].x, cols[1].x)) *
        Math.max(0, Math.min(cols[0].bottom, cols[1].bottom) - Math.max(cols[0].y, cols[1].y))
      : -1;
    record("9.2", "手机：两列改为单列上下堆叠、卡片不重叠", stacked && overlap === 0, { cols, overlap });
    const card = s.styles.card;
    record("9.3", "手机：仍为扁平白卡（白底/1px 边/无阴影无渐变），无横向裁切", card && card.bg === "rgb(255, 255, 255)" && card.borderTopWidth === "1px" && card.bgImage === "none" && card.boxShadow === "none" && s.flatViolations.length === 0 && s.shadowViolations.length === 0, {
      card, flatViolations: s.flatViolations.slice(0, 6), shadowViolations: s.shadowViolations.slice(0, 6)
    });
    record("9.4", "手机：公式与结果清晰可读（结果 KaTeX 字号 >= 14px、结果区非空、预览 KaTeX 存在）", s.resultDisplay.katexCount > 0 && parseFloat(s.resultDisplay.katexFontSize) >= 14 && norm(s.resultDisplay.text).length > 0 && s.preview.katexCount > 0, {
      katexFontSize: s.resultDisplay.katexFontSize, resultText: s.resultDisplay.text, previewKatex: s.preview.katexCount
    });
    const badBtns = s.buttons.filter((b) => b.visible && b.rect.w > 0 && (b.rect.w < 24 || b.rect.h < 24 || b.rect.right > s.layout.innerWidth + 2));
    record("9.5", "手机：按钮可点且未横向溢出（>= 24px）", badBtns.length === 0, badBtns);
    // 6 阶不溢出（当前 n=4，+2 到 6）
    await clickSelector("#size-inc");
    await sleep(400);
    await clickSelector("#size-inc");
    await sleep(400);
    s = await snap();
    record("9.6", "手机 6 阶矩阵：输入格 36 个且页面/矩阵区无横向溢出", s.n === 6 && s.cellCount === 36 && s.layout.scrollWidth <= s.layout.innerWidth + 2, {
      n: s.n, cells: s.cellCount, scrollWidth: s.layout.scrollWidth, innerWidth: s.layout.innerWidth
    });
    // 回到范德蒙德 4×4 + 代入结果，作为手机截图状态
    await clickSelector('.example-btn[data-example="vandermonde"]');
    await waitFor('window.DetPage && window.DetPage.getResult() && window.DetPage.getResult().mode === "symbolic"', 8000, "手机截图用范德蒙德");
    await typeValue('#var-inputs input[data-var="a"]', "1");
    await typeValue('#var-inputs input[data-var="b"]', "2");
    await typeValue('#var-inputs input[data-var="c"]', "3");
    await typeValue('#var-inputs input[data-var="d"]', "4");
    await clickSelector("#substitute-btn");
    await tryWait('(() => { const n = document.getElementById("substitute-result"); return n && !n.hidden; })()', 5000);
    await evalJS("window.scrollTo(0, 0)");
    await sleep(600);
    s = await snap();
    const shot = await screenshot("mobile-390x844.png", SHOT_WIDTH_MOBILE);
    record("9.7", "手机整页截图已保存（390×整页高度 PNG，非空）", shot.bytes > 20000 && shot.dim && shot.dim.w === SHOT_WIDTH_MOBILE && shot.dim.h === shot.requestedHeight, shot);
    info("截图", "手机截图", shot.file + "  " + JSON.stringify(shot.dim) + "  " + Math.round(shot.bytes / 1024) + "KB");
    // 手机最终态再确认无溢出
    record("9.8", "手机截图状态无横向溢出且结果/代入结果均可见", s.layout.scrollWidth <= s.layout.innerWidth + 2 && s.resultBodyVisible && s.substitute.visible, {
      scrollWidth: s.layout.scrollWidth, innerWidth: s.layout.innerWidth, resultBody: s.resultBodyVisible, substitute: s.substitute.visible
    });
    record("9.9", "手机：导航折叠为汉堡菜单、紫色页脚保留", s.chrome.mobileMenuVisible === true && s.chrome.navLinksVisible === 0 && /133, 39, 210/.test(String(s.chrome.footerBgColor)), s.chrome);
    const clipMobile = await evalJS(`(() => {
      const box = document.getElementById("result-display");
      if (!box || !box.firstElementChild) return null;
      const inner = box.firstElementChild;
      const b = box.getBoundingClientRect();
      box.scrollLeft = 0;
      const leftAt0 = inner.getBoundingClientRect().left - b.left;
      box.scrollLeft = -1e6;
      const minScroll = box.scrollLeft;
      const leftAfterMin = inner.getBoundingClientRect().left - b.left;
      return {
        clientWidth: box.clientWidth, scrollWidth: box.scrollWidth,
        canScroll: box.scrollWidth > box.clientWidth + 1,
        innerLeftAtScroll0: Math.round(leftAt0), minScrollLeft: minScroll,
        innerLeftAfterMinScroll: Math.round(leftAfterMin)
      };
    })()`);
    info("9.10", "手机端长公式（范德蒙德 4×4 展开式）在结果框内的横向滚动/裁切测量", clipMobile);
    if (clipMobile && clipMobile.canScroll && clipMobile.innerLeftAfterMinScroll < -1) {
      notes.push("发现（手机 390px）：长公式同样被裁掉左侧（innerLeft=" + clipMobile.innerLeftAfterMinScroll + "px，scrollLeft 最小 " + clipMobile.minScrollLeft + "，clientWidth=" + clipMobile.clientWidth + " / scrollWidth=" + clipMobile.scrollWidth + "）。");
    }
  });

  /* ---------- 汇总 ---------- */
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log("\n=== 控制台消息 ===");
  if (!consoleErrors.length && !consoleOthers.length) console.log("（无控制台消息）");
  for (const e of consoleErrors) {
    const known = classifyConsole(e.text);
    console.log(`[error] ${e.text} ${e.loc || e.url || ""}${known ? "  ⟵ 已知：" + known : "  ⟵ 未分类"}`);
  }
  for (const e of consoleOthers) {
    console.log(`[${(e.kind || "console").replace(/^console\./, "").replace(/^log\./, "log ")}] ${e.text} ${e.loc || e.url || ""}`);
  }
  if (pageExceptions.length) console.log("页面异常:", JSON.stringify(pageExceptions));
  if (notes.length) {
    console.log("\n=== 测试备注 ===");
    for (const n of notes) console.log("- " + n);
  }
  console.log("\n=== 截图路径 ===");
  for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith(".png")).sort()) {
    console.log(path.join(OUT, f));
  }
  console.log("\n=== 汇总 ===");
  console.log(`PASS ${pass} / FAIL ${fail} / INFO ${infos.length}`);
  if (fail) {
    console.log("\n=== FAIL 列表（问题 + 复现步骤） ===");
    for (const r of results.filter((r) => !r.ok)) {
      console.log(`- [${r.id}] ${r.title}`);
      if (r.evidence !== undefined) console.log("  证据: " + short(r.evidence));
    }
  }
  console.log("\nRESULT: " + (fail ? "FAIL" : "PASS"));
  ws.close();
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
