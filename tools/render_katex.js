/* 离线批量 KaTeX 预渲染（与仓库现有 crypto-des-aes 页面的做法一致：构建期渲染，页面不加载 katex JS）
 *
 * 用法: node tools/render_katex.js <in.json> <out.json>
 *   in.json  : [{"tex": "...", "display": false}, ...]
 *   out.json : [{"ok": true, "html": "<span class=\"katex\">..."} | {"ok": false, "error": "..."}]
 *
 * KaTeX 取自仓库本地 assets/katex/katex.min.js（UMD 构建，renderToString 不依赖 DOM）。
 */
"use strict";
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const katexPath = path.join(root, "assets", "katex", "katex.min.js");
const inPath = process.argv[2];
const outPath = process.argv[3];

if (!inPath || !outPath) {
  console.error("usage: node render_katex.js <in.json> <out.json>");
  process.exit(2);
}

const katex = require(katexPath);
const items = JSON.parse(fs.readFileSync(inPath, "utf8"));

const out = items.map(function (it) {
  try {
    const html = katex.renderToString(it.tex, {
      displayMode: !!it.display,
      throwOnError: true,
      strict: false,
      trust: false,
      output: "htmlAndMathml"
    });
    return { ok: true, html: html };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

fs.writeFileSync(outPath, JSON.stringify(out), "utf8");
console.log("rendered " + out.length + " formulas, failed " + out.filter(function (r) { return !r.ok; }).length);
