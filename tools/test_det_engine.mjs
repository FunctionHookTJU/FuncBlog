#!/usr/bin/env node
/**
 * tools/test_det_engine.mjs
 *
 * 对 scripts/detEngine.js 的独立、对抗性数学验证（math-verifier 编写）。
 *
 * 原则：
 *  - 只依赖 Node 内置模块 + 仓库内 assets/katex（不联网、不装包）。
 *  - 参考实现完全自写（BigInt 分数高斯消元 / Bareiss），不复用引擎代码。
 *  - 失败如实报告；不为通过而放宽断言。
 *
 * 运行：node tools/test_det_engine.mjs
 * 退出码：0 = 全过；1 = 有失败；2 = 引擎不存在/无法加载（测试框架就绪，等待引擎）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const ENGINE_PATH = path.join(ROOT, 'scripts', 'detEngine.js');
const KATEX_PATH = path.join(ROOT, 'assets', 'katex', 'katex.min.js');

// ===========================================================================
// 0. 加载引擎（缺失时优雅退出 2）
// ===========================================================================
let DetEngine = null;
if (!fs.existsSync(ENGINE_PATH)) {
  console.error(`[SKIP] 引擎尚未就绪：${ENGINE_PATH} 不存在。`);
  console.error('       测试框架已就绪；待 scripts/detEngine.js 出现后重新运行：node tools/test_det_engine.mjs');
  process.exit(2);
}
try {
  DetEngine = require(ENGINE_PATH);
} catch (err) {
  console.error(`[SKIP] 引擎无法加载（语法错误或依赖问题）：${ENGINE_PATH}`);
  console.error(String((err && err.stack) || err));
  process.exit(2);
}
if (!DetEngine || typeof DetEngine.compute !== 'function') {
  console.error('[SKIP] 引擎已加载，但缺少 DetEngine.compute（UMD 导出不完整）。');
  console.error('       期望：browser 挂 globalThis.DetEngine，Node 下 require 返回同一对象。');
  process.exit(2);
}

// ===========================================================================
// 1. 迷你断言框架
// ===========================================================================
let pass = 0;
let fail = 0;
const failures = [];
const groupStats = [];
const notes = [];
let currentGroup = '(none)';

class TestFailure extends Error {}
function failMsg(msg) {
  throw new TestFailure(msg);
}
function show(v) {
  if (typeof v === 'bigint') return `${v}n`;
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch {
    return String(v);
  }
}
function note(msg) {
  if (!notes.includes(msg)) notes.push(msg);
}

function check(name, fn) {
  try {
    fn();
    pass++;
  } catch (err) {
    fail++;
    const message =
      err instanceof TestFailure
        ? err.message
        : (err && err.stack) || String(err);
    failures.push({ group: currentGroup, name, message });
  }
}

function group(name, fn) {
  const prev = currentGroup;
  currentGroup = name;
  const p0 = pass;
  const f0 = fail;
  try {
    fn();
  } catch (err) {
    fail++;
    failures.push({
      group: name,
      name: '<整组异常>',
      message: (err && err.stack) || String(err),
    });
  }
  currentGroup = prev;
  groupStats.push({ name, pass: pass - p0, fail: fail - f0 });
  console.log(`\n== ${name} ==  PASS ${pass - p0}  FAIL ${fail - f0}`);
}

// ---- 断言 ----
function assert(cond, msg) {
  if (!cond) failMsg(msg);
}
function assertEq(actual, expected, label) {
  if (!Object.is(actual, expected)) {
    failMsg(`${label}: 期望 ${show(expected)}，实际 ${show(actual)}`);
  }
}
function assertDeepEq(actual, expected, label) {
  if (show(actual) !== show(expected)) {
    failMsg(`${label}: 期望 ${show(expected)}，实际 ${show(actual)}`);
  }
}
function assertNear(actual, expected, tol, label) {
  if (typeof actual !== 'number' || !Number.isFinite(actual)) {
    failMsg(`${label}: 期望 ≈ ${expected}，实际 ${show(actual)}`);
  }
  const diff = Math.abs(actual - expected);
  const scale = Math.max(1, Math.abs(expected));
  if (!(diff <= tol * scale)) {
    failMsg(`${label}: 期望 ≈ ${expected}（tol ${tol}），实际 ${actual}（差 ${diff}）`);
  }
}
function assertThrows(fn, label, opts = {}) {
  let err = null;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  if (err === null) failMsg(`${label}: 期望抛错，但调用成功返回`);
  const msg = String((err && err.message) || err);
  if (opts.zh !== false) {
    assert(/[\u4e00-\u9fff]/.test(msg), `${label}: 错误信息应为中文，实际 ${show(msg)}`);
  }
  if (opts.cell) {
    assert(
      err.cell && typeof err.cell === 'object',
      `${label}: Error 应带 .cell={r,c}，实际 .cell=${show(err.cell)}`
    );
    assert(
      Number.isInteger(err.cell.r) && Number.isInteger(err.cell.c),
      `${label}: .cell 的 r/c 应为 0 基整数，实际 ${show(err.cell)}`
    );
    if (opts.cell.r !== undefined) assertEq(err.cell.r, opts.cell.r, `${label}: .cell.r`);
    if (opts.cell.c !== undefined) assertEq(err.cell.c, opts.cell.c, `${label}: .cell.c`);
  }
  return err;
}

// ===========================================================================
// 2. 独立的 BigInt 有理数参考实现（分数高斯消元 + Bareiss）
// ===========================================================================
function gcdBig(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

class Frac {
  constructor(n, d = 1n) {
    n = BigInt(n);
    d = BigInt(d);
    if (d === 0n) throw new Error('Frac: 除以零');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcdBig(n, d);
    this.n = n / g;
    this.d = d / g;
  }
  static fromString(s) {
    const parts = String(s).split('/');
    return new Frac(BigInt(parts[0]), BigInt(parts[1] === undefined ? '1' : parts[1]));
  }
  add(o) {
    return new Frac(this.n * o.d + o.n * this.d, this.d * o.d);
  }
  sub(o) {
    return new Frac(this.n * o.d - o.n * this.d, this.d * o.d);
  }
  mul(o) {
    return new Frac(this.n * o.n, this.d * o.d);
  }
  div(o) {
    if (o.n === 0n) throw new Error('Frac: 除以零');
    return new Frac(this.n * o.d, this.d * o.n);
  }
  neg() {
    return new Frac(-this.n, this.d);
  }
  isZero() {
    return this.n === 0n;
  }
  toNumber() {
    return Number(this.n) / Number(this.d);
  }
  toString() {
    return this.d === 1n ? `${this.n}` : `${this.n}/${this.d}`;
  }
}

/** 参考实现 1：分数高斯消元求 det（任意有理数矩阵）。 */
function refDetFrac(rows) {
  const n = rows.length;
  if (n === 0) return new Frac(1n);
  const M = rows.map((r) => r.slice());
  let det = new Frac(1n);
  for (let col = 0; col < n; col++) {
    let piv = -1;
    for (let r = col; r < n; r++) {
      if (!M[r][col].isZero()) {
        piv = r;
        break;
      }
    }
    if (piv < 0) return new Frac(0n); // 整列是 0 → 奇异
    if (piv !== col) {
      const t = M[piv];
      M[piv] = M[col];
      M[col] = t;
      det = det.neg();
    }
    det = det.mul(M[col][col]);
    const inv = M[col][col];
    for (let r = col + 1; r < n; r++) {
      if (M[r][col].isZero()) continue;
      const f = M[r][col].div(inv);
      for (let c = col; c < n; c++) {
        M[r][c] = M[r][c].sub(f.mul(M[col][c]));
      }
    }
  }
  return det;
}

/** 参考实现 2：整数矩阵的分数无关 Bareiss 消元。 */
function refDetBareiss(intRows) {
  const n = intRows.length;
  if (n === 0) return 1n;
  const M = intRows.map((r) => r.map((v) => BigInt(v)));
  let sign = 1n;
  let prev = 1n;
  for (let k = 0; k < n - 1; k++) {
    if (M[k][k] === 0n) {
      let s = -1;
      for (let i = k + 1; i < n; i++) {
        if (M[i][k] !== 0n) {
          s = i;
          break;
        }
      }
      if (s < 0) return 0n;
      const t = M[k];
      M[k] = M[s];
      M[s] = t;
      sign = -sign;
    }
    for (let i = k + 1; i < n; i++) {
      for (let j = k + 1; j < n; j++) {
        M[i][j] = (M[i][j] * M[k][k] - M[i][k] * M[k][j]) / prev;
      }
      M[i][k] = 0n;
    }
    prev = M[k][k];
  }
  return sign * M[n - 1][n - 1];
}

// ---- 数值单元格字符串 → Frac（仅用于我自己生成的、格式受控的单元格）----
function parseDecLit(s) {
  const m = /^([+-]?)(\d+\.?\d*|\.\d+)(?:[eE]([+-]?\d+))?$/.exec(String(s).trim());
  if (!m) throw new Error(`参考实现无法解析数字字面量 ${JSON.stringify(s)}`);
  const sign = m[1] === '-' ? -1n : 1n;
  const [ip, fp = ''] = m[2].split('.');
  let n = BigInt((ip || '0') + fp);
  let d = 10n ** BigInt(fp.length);
  const e = m[3] ? parseInt(m[3], 10) : 0;
  if (e > 0) n *= 10n ** BigInt(e);
  else if (e < 0) d *= 10n ** BigInt(-e);
  return new Frac(sign * n, d);
}
function parseNumericCell(text) {
  const s = String(text).trim();
  try {
    return parseDecLit(s);
  } catch {
    /* fallthrough */
  }
  const parts = s.split('/');
  if (parts.length === 2) return parseDecLit(parts[0]).div(parseDecLit(parts[1]));
  throw new Error(`参考实现无法解析单元格 ${JSON.stringify(text)}`);
}
function fracRowMatrix(entries) {
  return entries.map((row) => row.map((cell) => parseNumericCell(cell)));
}

// ===========================================================================
// 3. 随机数与多项式工具
// ===========================================================================
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randInt(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}
function randIntMatrix(rng, n, lo, hi) {
  return Array.from({ length: n }, () =>
    Array.from({ length: n }, () => String(randInt(rng, lo, hi)))
  );
}
function randFracMatrix(rng, n) {
  return Array.from({ length: n }, () =>
    Array.from({ length: n }, () => {
      const num = randInt(rng, -12, 12);
      const den = randInt(rng, 1, 9);
      return `${num}/${den}`;
    })
  );
}
function randDecimalMatrix(rng, n) {
  return Array.from({ length: n }, () =>
    Array.from({ length: n }, () => {
      const places = randInt(rng, 1, 3);
      const v = randInt(rng, -30, 30);
      return (v / 10 ** places).toFixed(places);
    })
  );
}
function fracToValueString(f) {
  return f.d === 1n ? f.n.toString() : `${f.n}/${f.d}`;
}
function fracMapFromInts(values) {
  const out = {};
  for (const [k, v] of Object.entries(values)) out[k] = new Frac(BigInt(v));
  return out;
}

// ---- 随机多项式：terms=[{coef:number, mono:[var...]}] ----
function randPoly(rng, vars, maxTerms, coefMax) {
  const terms = [];
  const count = randInt(rng, 1, maxTerms);
  const seen = new Set();
  for (let t = 0; t < count; t++) {
    const deg = randInt(rng, 0, Math.min(2, vars.length));
    const mono = [];
    for (let i = 0; i < deg; i++) mono.push(vars[randInt(rng, 0, vars.length - 1)]);
    mono.sort();
    const key = mono.join('*');
    if (seen.has(key)) continue;
    seen.add(key);
    const coef = randInt(rng, 1, coefMax) * (rng() < 0.45 ? -1 : 1);
    terms.push({ coef, mono, key });
  }
  if (terms.length === 0) terms.push({ coef: randInt(rng, 1, coefMax), mono: [], key: '' });
  return terms;
}
function polyToText(terms) {
  let out = '';
  terms.forEach((t, i) => {
    const abs = Math.abs(t.coef);
    const mono = t.mono.join('*');
    let body;
    if (!mono) body = String(abs);
    else body = abs === 1 ? mono : `${abs}*${mono}`;
    if (i === 0) out += (t.coef < 0 ? '-' : '') + body;
    else out += (t.coef < 0 ? ' - ' : ' + ') + body;
  });
  return out;
}
function polyEval(terms, fracMap) {
  let acc = new Frac(0n);
  for (const t of terms) {
    let p = new Frac(BigInt(t.coef));
    for (const v of t.mono) p = p.mul(fracMap[v]);
    acc = acc.add(p);
  }
  return acc;
}
function genSymbolicMatrix(rng, n, vars, opts = {}) {
  const maxTerms = opts.maxTerms || 3;
  const coefMax = opts.coefMax || 3;
  const entries = [];
  const termsMatrix = [];
  const used = new Set();
  for (let r = 0; r < n; r++) {
    entries.push([]);
    termsMatrix.push([]);
    for (let c = 0; c < n; c++) {
      const terms = randPoly(rng, vars, maxTerms, coefMax);
      terms.forEach((t) => t.mono.forEach((v) => used.add(v)));
      entries[r].push(polyToText(terms));
      termsMatrix[r].push(terms);
    }
  }
  return { entries, termsMatrix, vars: [...used].sort() };
}
function refDetPolys(termsMatrix, fracMap) {
  return refDetFrac(
    termsMatrix.map((row) => row.map((terms) => polyEval(terms, fracMap)))
  );
}
function vandermondeDetFrac(fracs) {
  let p = new Frac(1n);
  for (let i = 0; i < fracs.length; i++) {
    for (let j = i + 1; j < fracs.length; j++) p = p.mul(fracs[j].sub(fracs[i]));
  }
  return p;
}

// ===========================================================================
// 4. 引擎辅助
// ===========================================================================
function computeOk(entries, options, label) {
  try {
    return DetEngine.compute(entries, options);
  } catch (err) {
    failMsg(`${label}: compute 意外抛错：${(err && err.message) || err}`);
  }
}
function assertResultShape(res, label, n) {
  assert(res && typeof res === 'object', `${label}: compute 应返回对象，实际 ${show(res)}`);
  const required = [
    'n', 'mode', 'variables', 'matrixLatex', 'resultLatex', 'resultText',
    'exact', 'decimal', 'decimalText', 'scientificText', 'scientificLatex',
    'formulaLatex', 'formulaText', 'constant', 'warnings',
  ];
  for (const k of required) assert(k in res, `${label}: 返回对象缺少字段 ${k}`);
  assertEq(res.n, n, `${label}: res.n`);
  assert(
    res.mode === 'exact' || res.mode === 'approx' || res.mode === 'symbolic',
    `${label}: res.mode 非法 ${show(res.mode)}`
  );
  assert(Array.isArray(res.variables), `${label}: res.variables 应为数组，实际 ${show(res.variables)}`);
  for (const v of res.variables) {
    assert(typeof v === 'string' && v.length > 0, `${label}: variables 含非法项 ${show(v)}`);
  }
  assert(
    typeof res.matrixLatex === 'string' &&
      res.matrixLatex.includes('\\begin{vmatrix}') &&
      res.matrixLatex.includes('\\end{vmatrix}'),
    `${label}: matrixLatex 应为 vmatrix 环境，实际 ${show(res.matrixLatex)}`
  );
  assert(typeof res.resultLatex === 'string' && res.resultLatex.length > 0, `${label}: resultLatex 应为非空字符串，实际 ${show(res.resultLatex)}`);
  assert(typeof res.resultText === 'string' && res.resultText.length > 0, `${label}: resultText 应为非空字符串，实际 ${show(res.resultText)}`);
  assert(res.exact === null || typeof res.exact === 'object', `${label}: exact 应为对象或 null，实际 ${show(res.exact)}`);
  assert(res.decimal === null || typeof res.decimal === 'number', `${label}: decimal 应为 number 或 null，实际 ${show(res.decimal)}`);
  assert(res.decimalText === null || typeof res.decimalText === 'string', `${label}: decimalText 应为 string 或 null，实际 ${show(res.decimalText)}`);
  assert(res.scientificText === null || typeof res.scientificText === 'string', `${label}: scientificText 应为 string 或 null，实际 ${show(res.scientificText)}`);
  assert(res.scientificLatex === null || typeof res.scientificLatex === 'string', `${label}: scientificLatex 应为 string 或 null，实际 ${show(res.scientificLatex)}`);
  assert(res.formulaLatex === null || typeof res.formulaLatex === 'string', `${label}: formulaLatex 应为 string 或 null，实际 ${show(res.formulaLatex)}`);
  assert(res.formulaText === null || typeof res.formulaText === 'string', `${label}: formulaText 应为 string 或 null，实际 ${show(res.formulaText)}`);
  assertEq(typeof res.constant, 'boolean', `${label}: constant 应为 boolean`);
  assert(Array.isArray(res.warnings), `${label}: warnings 应为数组，实际 ${show(res.warnings)}`);
}

/** 校验 exact 字段是约分后的 {n:string,d:string} 并返回 Frac。 */
function fracFromExact(exact, label) {
  assert(exact !== null && exact !== undefined, `${label}: exact 应为对象，实际 ${show(exact)}`);
  assert(
    typeof exact.n === 'string' && typeof exact.d === 'string',
    `${label}: exact.n/.d 应为 BigInt 字符串，实际 ${show(exact)}`
  );
  let n;
  let d;
  try {
    n = BigInt(exact.n);
    d = BigInt(exact.d);
  } catch {
    failMsg(`${label}: exact 含非法整数 ${show(exact)}`);
  }
  assert(d > 0n, `${label}: exact 分母应为正，实际 ${show(exact)}`);
  const g = gcdBig(n, d);
  assertEq(g, 1n, `${label}: exact 必须约分到最简，实际 ${show(exact)}`);
  return new Frac(n, d);
}
function assertExactEq(exact, expectedFrac, label) {
  const got = fracFromExact(exact, label);
  if (got.n * expectedFrac.d !== expectedFrac.n * got.d) {
    failMsg(`${label}: 期望 ${expectedFrac.toString()}，实际 ${got.toString()}（exact=${show(exact)}）`);
  }
}

// evaluateExpression 的 values 形式契约略含糊（number 或表达式字符串）——探测一次。
let evalValueMode = null;
function evalExprAt(text, values) {
  if (values === undefined) return DetEngine.evaluateExpression(text);
  if (evalValueMode === null) {
    try {
      DetEngine.evaluateExpression('x+1', { x: 2 });
      evalValueMode = 'number';
    } catch (e1) {
      try {
        DetEngine.evaluateExpression('x+1', { x: '2' });
        evalValueMode = 'string';
        note('evaluateExpression 的 values 需要表达式字符串而非 number（引擎行为，不影响数学结论）');
      } catch (e2) {
        evalValueMode = 'unknown';
        note(`evaluateExpression 拒绝 number 与 string 两种 values 形式：${(e2 && e2.message) || e2}`);
        throw e2;
      }
    }
  }
  if (evalValueMode === 'string') {
    const strMap = {};
    for (const [k, v] of Object.entries(values)) strMap[k] = typeof v === 'number' ? String(v) : v;
    return DetEngine.evaluateExpression(text, strMap);
  }
  return DetEngine.evaluateExpression(text, values);
}

// 希腊字母名（alpha 等）在引擎内部被规范化为 Unicode 希腊字母（α 等）。
// 变量列表/结果的“语义”校验在两种写法间做等价映射。
const GREEK_VAR_NAMES = {
  'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon',
  'θ': 'theta', 'λ': 'lambda', 'μ': 'mu', 'ξ': 'xi', 'ρ': 'rho',
  'σ': 'sigma', 'τ': 'tau', 'φ': 'phi', 'χ': 'chi', 'ψ': 'psi', 'ω': 'omega',
};
function canonicalVarName(v) {
  return GREEK_VAR_NAMES[v] || v;
}

function checkIntEvalAgainstPolys(res, termsMatrix, intValues, label) {
  const ref = refDetPolys(termsMatrix, fracMapFromInts(intValues));
  assertEq(ref.d, 1n, `${label}: 参考行列式在整数点应为整数，实际 ${ref.toString()}`);
  const expected = Number(ref.n);
  const got = evalExprAt(res.resultText, intValues);
  assert(
    typeof got === 'number' && Number.isFinite(got),
    `${label}: resultText 在 ${show(intValues)} 处求值失败，得到 ${show(got)}`
  );
  assertEq(got, expected, `${label}: resultText 在 ${show(intValues)} 处应等于 ${expected}，实际 ${got}`);
}

// ---- LaTeX ----
let katex = null;
let katexLoadError = null;
try {
  katex = require(KATEX_PATH);
  if (katex && typeof katex.renderToString !== 'function' && katex.default) katex = katex.default;
} catch (err) {
  katexLoadError = err;
}
if (!katex || typeof katex.renderToString !== 'function') {
  note(`KaTeX 未能在 Node 中加载（${(katexLoadError && katexLoadError.message) || 'renderToString 缺失'}），LaTeX 校验退化为结构检查。`);
  katex = null;
}
function latexCheck(src, label) {
  assert(typeof src === 'string' && src.length > 0, `${label}: LaTeX 应为非空字符串，实际 ${show(src)}`);
  if (katex) {
    let html = '';
    try {
      html = katex.renderToString(src, { throwOnError: true, displayMode: false });
    } catch (err) {
      failMsg(`${label}: KaTeX 渲染失败：${(err && err.message) || err}；LaTeX=${show(src)}`);
    }
    assert(typeof html === 'string' && html.length > 0, `${label}: KaTeX 渲染结果为空`);
  } else {
    const opens = (src.match(/\{/g) || []).length;
    const closes = (src.match(/\}/g) || []).length;
    assertEq(opens, closes, `${label}: LaTeX 花括号不配对：${show(src)}`);
    assert(!/undefined|NaN/.test(src), `${label}: LaTeX 含 undefined/NaN：${show(src)}`);
  }
}

// ===========================================================================
// 5. 测试组
// ===========================================================================

// ---------------------------------------------------------------------------
group('API 表面', () => {
  check('version 为非空字符串', () => {
    assertEq(typeof DetEngine.version, 'string', 'DetEngine.version 类型');
    assert(DetEngine.version.length > 0, 'DetEngine.version 不应为空');
  });
  for (const fnName of ['parseExpression', 'stringify', 'exprToLatex', 'evaluateExpression', 'compute']) {
    check(`导出函数 ${fnName}`, () => {
      assertEq(typeof DetEngine[fnName], 'function', `DetEngine.${fnName} 应为函数`);
    });
  }
  check('parseExpression 返回 AST，stringify 可往返', () => {
    const ast = DetEngine.parseExpression('sin(x)^2+cos(x)^2');
    assert(ast && typeof ast === 'object', `parseExpression 应返回对象，实际 ${show(ast)}`);
    const s = DetEngine.stringify(ast);
    assert(typeof s === 'string' && s.length > 0, `stringify 应返回非空字符串，实际 ${show(s)}`);
    const x = 0.7;
    assertNear(evalExprAt(s, { x }), evalExprAt('sin(x)^2+cos(x)^2', { x }), 1e-12, 'stringify 往返求值');
  });
  check('parseExpression 对非法表达式抛中文错误', () => {
    assertThrows(() => DetEngine.parseExpression(''), 'parseExpression("")');
    assertThrows(() => DetEngine.parseExpression('(1+2'), 'parseExpression("(1+2")');
  });
  check('exprToLatex 输出可渲染', () => {
    const latex = DetEngine.exprToLatex(DetEngine.parseExpression('sin(x)^2+cos(x)^2'));
    assert(typeof latex === 'string' && latex.length > 0, `exprToLatex 应返回非空字符串，实际 ${show(latex)}`);
    latexCheck(latex, 'exprToLatex(sin(x)^2+cos(x)^2)');
  });
});

// ---------------------------------------------------------------------------
group('表达式解析与求值（数值）', () => {
  check('数字字面量：小数、指数', () => {
    assertEq(DetEngine.evaluateExpression('.5'), 0.5, '.5');
    assertNear(DetEngine.evaluateExpression('1e-3'), 0.001, 1e-15, '1e-3');
    assertEq(DetEngine.evaluateExpression('2E3'), 2000, '2E3');
    assertEq(DetEngine.evaluateExpression('-0.25'), -0.25, '-0.25');
    assertEq(DetEngine.evaluateExpression('1e2'), 100, '1e2');
    assertNear(DetEngine.evaluateExpression('1.5e-2'), 0.015, 1e-15, '1.5e-2');
    assertEq(DetEngine.evaluateExpression('0'), 0, '0');
  });
  check('运算符优先级与结合性', () => {
    assertEq(DetEngine.evaluateExpression('1+2*3'), 7, '1+2*3');
    assertEq(DetEngine.evaluateExpression('(1+2)*3'), 9, '(1+2)*3');
    assertEq(DetEngine.evaluateExpression('2-3-4'), -5, '2-3-4 左结合');
    assertEq(DetEngine.evaluateExpression('8/4/2'), 1, '8/4/2 左结合');
    assertEq(DetEngine.evaluateExpression('2*3^2'), 18, '2*3^2');
    assertEq(DetEngine.evaluateExpression('-2^2'), -4, '-2^2 = -4');
    assertEq(DetEngine.evaluateExpression('(-2)^2'), 4, '(-2)^2');
    assertEq(DetEngine.evaluateExpression('2^3^2'), 512, '2^3^2 右结合');
    assertEq(DetEngine.evaluateExpression('2^-3'), 0.125, '2^-3');
    assertEq(DetEngine.evaluateExpression('2^-2^2'), 1 / 16, '2^-2^2 右结合');
  });
  check('隐式乘法', () => {
    assertEq(evalExprAt('2x', { x: 3 }), 6, '2x');
    assertEq(evalExprAt('2(x+1)', { x: 3 }), 8, '2(x+1)');
    assertEq(evalExprAt('(a+b)(a-b)', { a: 5, b: 3 }), 16, '(a+b)(a-b)');
    assertEq(evalExprAt('1/2x', { x: 4 }), 2, '1/2x = (1/2)x');
    assertEq(evalExprAt('2/2x', { x: 3 }), 3, '2/2x = (2/2)x');
    assertEq(evalExprAt('2x^2', { x: 3 }), 18, '2x^2 = 2*(x^2)');
    assertEq(evalExprAt('x y', { x: 2, y: 3 }), 6, 'x y 空格隐式乘法');
    assertEq(evalExprAt('3x y', { x: 2, y: 3 }), 18, '3x y');
    assertEq(evalExprAt('x(x+1)', { x: 3 }), 12, 'x(x+1)');
    assertEq(evalExprAt('-2(x+1)', { x: 1 }), -4, '-2(x+1)');
  });
  check('常量 pi、e', () => {
    assertNear(DetEngine.evaluateExpression('pi'), Math.PI, 1e-15, 'pi');
    assertNear(DetEngine.evaluateExpression('e'), Math.E, 1e-15, 'e');
    assertNear(DetEngine.evaluateExpression('pi/2'), Math.PI / 2, 1e-15, 'pi/2');
    assertNear(DetEngine.evaluateExpression('e^1'), Math.E, 1e-15, 'e^1');
  });
  check('三角函数', () => {
    assertNear(DetEngine.evaluateExpression('sin(pi/2)'), 1, 1e-12, 'sin(pi/2)');
    assertNear(DetEngine.evaluateExpression('cos(0)'), 1, 1e-12, 'cos(0)');
    assertNear(DetEngine.evaluateExpression('tan(pi/4)'), 1, 1e-12, 'tan(pi/4)');
    assertNear(DetEngine.evaluateExpression('cot(pi/4)'), 1, 1e-12, 'cot(pi/4)');
    assertNear(DetEngine.evaluateExpression('sec(0)'), 1, 1e-12, 'sec(0)');
    assertNear(DetEngine.evaluateExpression('csc(pi/2)'), 1, 1e-12, 'csc(pi/2)');
    assertNear(DetEngine.evaluateExpression('asin(0)'), 0, 1e-12, 'asin(0)');
    assertNear(DetEngine.evaluateExpression('acos(1)'), 0, 1e-12, 'acos(1)');
    assertNear(DetEngine.evaluateExpression('atan(1)'), Math.PI / 4, 1e-12, 'atan(1)');
  });
  check('双曲函数与指数对数', () => {
    assertNear(DetEngine.evaluateExpression('sinh(0)'), 0, 1e-12, 'sinh(0)');
    assertNear(DetEngine.evaluateExpression('cosh(0)'), 1, 1e-12, 'cosh(0)');
    assertNear(DetEngine.evaluateExpression('tanh(0)'), 0, 1e-12, 'tanh(0)');
    assertNear(DetEngine.evaluateExpression('exp(1)'), Math.E, 1e-12, 'exp(1)');
    assertNear(DetEngine.evaluateExpression('ln(e)'), 1, 1e-12, 'ln(e)');
    assertNear(DetEngine.evaluateExpression('log10(1000)'), 3, 1e-12, 'log10(1000)');
    assertNear(DetEngine.evaluateExpression('sqrt(9)'), 3, 1e-12, 'sqrt(9)');
    assertNear(DetEngine.evaluateExpression('abs(-5)'), 5, 1e-12, 'abs(-5)');
    assertEq(DetEngine.evaluateExpression('sqrt(4)'), 2, 'sqrt(4) 精确等于 2');
  });
  check('错误：空表达式、括号不配对', () => {
    assertThrows(() => DetEngine.evaluateExpression(''), '空表达式');
    assertThrows(() => DetEngine.evaluateExpression('   '), '空白表达式');
    assertThrows(() => DetEngine.evaluateExpression('(1+2'), '括号不配对 (1+2');
    assertThrows(() => DetEngine.evaluateExpression('1+2)'), '括号不配对 1+2)');
    assertThrows(() => DetEngine.evaluateExpression('((1)'), '括号不配对 ((1)');
  });
  check('错误：函数语法/未知函数', () => {
    assertThrows(() => DetEngine.evaluateExpression('sin 1'), '函数缺括号 sin 1');
    assertThrows(() => DetEngine.evaluateExpression('sin(1'), '函数括号未闭合 sin(1');
    assertThrows(() => DetEngine.evaluateExpression('foo(1)'), '未知函数 foo(1)');
    assertThrows(() => DetEngine.evaluateExpression('ln()'), '空参数 ln()');
    assertThrows(() => DetEngine.evaluateExpression('sin()'), '空参数 sin()');
  });
  check('错误：除以零、非法字符、指数含变量', () => {
    assertThrows(() => DetEngine.evaluateExpression('1/0'), '除以零 1/0');
    assertThrows(() => DetEngine.evaluateExpression('0^-1'), '0^-1');
    assertThrows(() => DetEngine.evaluateExpression('1$2'), '非法字符 $');
    assertThrows(() => DetEngine.evaluateExpression('#'), '非法字符 #');
    assertThrows(() => DetEngine.evaluateExpression('2^x'), '指数含变量 2^x（无 values）');
    assertThrows(() => DetEngine.evaluateExpression('x'), '未知变量 x');
  });
  check('evaluateExpression 变量代入形式', () => {
    const v = evalExprAt('2x+1', { x: 3 });
    assertNear(v, 7, 1e-12, 'evaluateExpression("2x+1",{x:3})');
  });
});

// ---------------------------------------------------------------------------
group('精确有理数与已知行列式', () => {
  const known = [
    { label: '1x1', entries: [['5']], expected: '5/1' },
    { label: '2x2', entries: [['1', '2'], ['3', '4']], expected: '-2/1' },
    { label: '3x3 已知', entries: [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '10']], expected: '-3/1' },
    { label: '3x3 奇异', entries: [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']], expected: '0/1' },
    { label: '2x2 奇异', entries: [['1', '2'], ['2', '4']], expected: '0/1' },
    { label: '置换矩阵(偶)', entries: [['0', '1', '0'], ['0', '0', '1'], ['1', '0', '0']], expected: '1/1' },
    { label: '置换矩阵(奇)', entries: [['0', '1', '0'], ['1', '0', '0'], ['0', '0', '1']], expected: '-1/1' },
    { label: '2x2 零矩阵', entries: [['0', '0'], ['0', '0']], expected: '0/1' },
    { label: '对角阵', entries: [['2', '0', '0'], ['0', '-3', '0'], ['0', '0', '5']], expected: '-30/1' },
  ];
  for (const k of known) {
    check(`已知行列式 ${k.label} ${JSON.stringify(k.entries)}`, () => {
      const res = computeOk(k.entries, undefined, k.label);
      assertResultShape(res, k.label, k.entries.length);
      assertEq(res.mode, 'exact', `${k.label}: 全整数矩阵应为 exact 模式`);
      assertExactEq(res.exact, Frac.fromString(k.expected), k.label);
      assertDeepEq(res.variables, [], `${k.label}: variables 应为空`);
      assertEq(res.constant, true, `${k.label}: constant`);
      if (res.decimal !== null) {
        assertNear(res.decimal, Frac.fromString(k.expected).toNumber(), 1e-12, `${k.label}: decimal`);
      }
    });
  }

  check('空单元格视为 0', () => {
    const res1 = computeOk([['']], undefined, '空矩阵 1x1');
    assertResultShape(res1, '空单元格', 1);
    assertExactEq(res1.exact, Frac.fromString('0/1'), '1x1 空单元格行列式');
    const res2 = computeOk([['1', ''], ['', '1']], undefined, '空单元格单位阵');
    assertExactEq(res2.exact, Frac.fromString('1/1'), '2x2 空单元格单位阵');
    const res3 = computeOk([['', '2'], ['3', '']], undefined, '空单元格');
    assertExactEq(res3.exact, Frac.fromString('-6/1'), '空单元格 2x2');
  });

  check('精确有理数：0.1+0.2=3/10', () => {
    const res = computeOk([['0.1+0.2']], undefined, '0.1+0.2');
    assertEq(res.mode, 'exact', '0.1+0.2 应为 exact 模式');
    assertExactEq(res.exact, Frac.fromString('3/10'), '0.1+0.2');
  });
  check('精确有理数：1/3 与小数矩阵', () => {
    const r1 = computeOk([['1/3']], undefined, '1/3');
    assertExactEq(r1.exact, Frac.fromString('1/3'), '1x1 1/3');
    const r2 = computeOk([['0.1', '0.2'], ['0.3', '0.4']], undefined, '小数 2x2');
    assertExactEq(r2.exact, Frac.fromString('-1/50'), '[[.1,.2],[.3,.4]]');
    const r3 = computeOk([['1.5', '-2.25'], ['0.5', '4']], undefined, '小数 2x2 b');
    assertExactEq(r3.exact, Frac.fromString('57/8'), '[[1.5,-2.25],[.5,4]]');
    const r4 = computeOk([['1/3', '1/2'], ['1/5', '1/7']], undefined, '分数 2x2');
    assertExactEq(r4.exact, Frac.fromString('-11/210'), '[[1/3,1/2],[1/5,1/7]]');
    const r5 = computeOk([['0.125', '1/8'], ['1/16', '0.0625']], undefined, '混合 2x2');
    assertExactEq(r5.exact, Frac.fromString('0/1'), '[[0.125,1/8],[1/16,0.0625]]');
  });
  check('大整数不丢精度', () => {
    const big = '9007199254740993'; // 2^53+1
    const r1 = computeOk([[big]], undefined, '2^53+1');
    assertExactEq(r1.exact, Frac.fromString(`${big}/1`), '1x1 2^53+1');
    const r2 = computeOk([[big, '2'], ['3', '4']], undefined, '2^53+1 矩阵');
    assertExactEq(r2.exact, Frac.fromString(`${9007199254740993n * 4n - 6n}/1`), '[[2^53+1,2],[3,4]]');
    const huge = '123456789012345678901234567890';
    const r3 = computeOk([[huge]], undefined, '30 位整数');
    assertExactEq(r3.exact, Frac.fromString(`${huge}/1`), '1x1 30 位整数');
  });
  check('单位阵 1..6 阶行列式均为 1', () => {
    for (let n = 1; n <= 6; n++) {
      const entries = Array.from({ length: n }, (_, r) =>
        Array.from({ length: n }, (_, c) => (r === c ? '1' : '0'))
      );
      const res = computeOk(entries, undefined, `${n} 阶单位阵`);
      assertResultShape(res, `${n} 阶单位阵`, n);
      assertEq(res.mode, 'exact', `${n} 阶单位阵 mode`);
      assertExactEq(res.exact, Frac.fromString('1/1'), `${n} 阶单位阵`);
    }
  });
  check('上三角阵 = 对角积', () => {
    const res = computeOk(
      [['2', '9', '-4'], ['0', '3', '7'], ['0', '0', '-5']],
      undefined,
      '上三角'
    );
    assertExactEq(res.exact, Frac.fromString('-30/1'), '上三角 3x3');
    const frac = computeOk(
      [['1/2', '1', '2'], ['0', '2/3', '1'], ['0', '0', '3/4']],
      undefined,
      '上三角 分数'
    );
    assertExactEq(frac.exact, Frac.fromString('1/4'), '上三角分数（1/2*2/3*3/4=1/4）');
  });
  check('转置行列式不变（数值）', () => {
    const rng = mulberry32(0x7E57);
    for (let k = 0; k < 6; k++) {
      const n = randInt(rng, 2, 5);
      const entries = randIntMatrix(rng, n, -20, 20);
      const transposed = entries[0].map((_, c) => entries.map((row) => row[c]));
      const a = computeOk(entries, undefined, `转置数值 #${k}`);
      const b = computeOk(transposed, undefined, `转置数值 T #${k}`);
      assertExactEq(a.exact, fracFromExact(b.exact, `转置数值 #${k} b`), `转置数值 #${k}`);
    }
  });
});

// ---------------------------------------------------------------------------
group('随机数值行列式（对照 BigInt 分数高斯消元）', () => {
  check('参考实现自检：分数高斯消元 vs Bareiss', () => {
    const rng = mulberry32(0xBEEF);
    for (let k = 0; k < 10; k++) {
      const n = randInt(rng, 2, 5);
      const entries = randIntMatrix(rng, n, -8, 8);
      const f = refDetFrac(fracRowMatrix(entries));
      const b = refDetBareiss(entries);
      assertEq(f.d, 1n, `参考自检 #${k}: 整数矩阵 det 应为整数`);
      assertEq(f.n, b, `参考自检 #${k}: Gauss=${f.n} Bareiss=${b} entries=${JSON.stringify(entries)}`);
    }
  });

  const rngInt = mulberry32(0xA11CE);
  for (let i = 0; i < 60; i++) {
    const n = i < 6 ? i + 1 : randInt(rngInt, 2, 6);
    const entries = randIntMatrix(rngInt, n, -9, 9);
    check(`随机整数 #${i} n=${n} ${JSON.stringify(entries)}`, () => {
      const res = computeOk(entries, undefined, `随机整数 #${i}`);
      assertResultShape(res, `随机整数 #${i}`, n);
      assertEq(res.mode, 'exact', `随机整数 #${i}: mode 应为 exact`);
      assertDeepEq(res.variables, [], `随机整数 #${i}: variables`);
      assertEq(res.constant, true, `随机整数 #${i}: constant`);
      const ref = refDetFrac(fracRowMatrix(entries));
      assertExactEq(res.exact, ref, `随机整数 #${i}`);
      if (res.decimal !== null) {
        assertNear(res.decimal, ref.toNumber(), 1e-12, `随机整数 #${i}: decimal`);
      }
    });
  }

  const rngFrac = mulberry32(0xF00D);
  for (let i = 0; i < 20; i++) {
    const n = randInt(rngFrac, 2, 5);
    const entries = randFracMatrix(rngFrac, n);
    check(`随机分数 #${i} n=${n} ${JSON.stringify(entries)}`, () => {
      const res = computeOk(entries, undefined, `随机分数 #${i}`);
      assertResultShape(res, `随机分数 #${i}`, n);
      assertEq(res.mode, 'exact', `随机分数 #${i}: mode 应为 exact`);
      assertExactEq(res.exact, refDetFrac(fracRowMatrix(entries)), `随机分数 #${i}`);
    });
  }

  const rngDec = mulberry32(0xDEC1);
  for (let i = 0; i < 12; i++) {
    const n = randInt(rngDec, 2, 4);
    const entries = randDecimalMatrix(rngDec, n);
    check(`随机小数 #${i} n=${n} ${JSON.stringify(entries)}`, () => {
      const res = computeOk(entries, undefined, `随机小数 #${i}`);
      assertResultShape(res, `随机小数 #${i}`, n);
      assertEq(res.mode, 'exact', `随机小数 #${i}: mode 应为 exact`);
      assertExactEq(res.exact, refDetFrac(fracRowMatrix(entries)), `随机小数 #${i}`);
    });
  }

  const rngBig = mulberry32(0xb16b16);
  for (let i = 0; i < 8; i++) {
    const n = randInt(rngBig, 3, 6);
    const entries = Array.from({ length: n }, () =>
      Array.from({ length: n }, () => {
        const digits = randInt(rngBig, 10, 16);
        let s = String(randInt(rngBig, 1, 9));
        for (let k = 1; k < digits; k++) s += String(randInt(rngBig, 0, 9));
        return (rngBig() < 0.5 ? '-' : '') + s;
      })
    );
    check(`随机大整数 #${i} n=${n} ${JSON.stringify(entries)}`, () => {
      const res = computeOk(entries, undefined, `随机大整数 #${i}`);
      assertResultShape(res, `随机大整数 #${i}`, n);
      assertEq(res.mode, 'exact', `随机大整数 #${i}: mode 应为 exact`);
      assertExactEq(res.exact, refDetFrac(fracRowMatrix(entries)), `随机大整数 #${i}`);
    });
  }

  const rngSing = mulberry32(0x5161);
  for (let i = 0; i < 10; i++) {
    const n = randInt(rngSing, 2, 6);
    const entries = randIntMatrix(rngSing, n, -9, 9);
    const dup = randInt(rngSing, 0, n - 1);
    let target = randInt(rngSing, 0, n - 1);
    while (target === dup) target = randInt(rngSing, 0, n - 1);
    entries[target] = entries[dup].slice();
    check(`重复行奇异 #${i} n=${n} ${JSON.stringify(entries)}`, () => {
      const res = computeOk(entries, undefined, `重复行 #${i}`);
      assertExactEq(res.exact, Frac.fromString('0/1'), `重复行 #${i} 应为 0`);
    });
  }
});

// ---------------------------------------------------------------------------
group('模式判定 / 小数 / 科学计数 / 公式', () => {
  check('exact 模式字段', () => {
    const res = computeOk([['1/3']], undefined, 'exact 1/3');
    assertEq(res.mode, 'exact', '1/3 mode');
    assert(res.exact !== null, '1/3 exact 非 null');
    assertEq(res.decimal !== null, true, '1/3 应给出 decimal');
    assertNear(res.decimal, 1 / 3, 1e-12, '1/3 decimal');
    assertEq(typeof res.decimalText, 'string', 'decimalText');
    assertEq(res.variables.length, 0, 'variables');
    assertEq(res.constant, true, 'constant');
    assertNear(DetEngine.evaluateExpression(res.resultText), res.decimal, 1e-12, 'exact 模式 resultText 求值应等于 decimal');
    latexCheck(res.resultLatex, 'exact 1/3 resultLatex');
  });
  check('sqrt(4) 精确为 2', () => {
    const res = computeOk([['sqrt(4)']], undefined, 'sqrt(4)');
    assertEq(res.mode, 'exact', 'sqrt(4) 应为 exact 模式（结果是 2）');
    assertExactEq(res.exact, Frac.fromString('2/1'), 'sqrt(4)');
    assertEq(res.decimal, 2, 'sqrt(4) decimal');
  });
  check('apropos 模式：sqrt(2) 矩阵', () => {
    const entries = [['sqrt(2)', '0'], ['0', '1']];
    const res = computeOk(entries, undefined, 'sqrt(2) 矩阵');
    assertResultShape(res, 'sqrt(2) 矩阵', 2);
    assertEq(res.mode, 'approx', '含无理常数的矩阵应为 approx 模式');
    assertEq(res.exact, null, 'approx 模式 exact 应为 null');
    assertNear(res.decimal, Math.SQRT2, 1e-12, 'sqrt(2) 矩阵 decimal');
    assertEq(typeof res.decimalText, 'string', 'decimalText');
    assertEq(typeof res.scientificText, 'string', 'scientificText');
    assertEq(typeof res.scientificLatex, 'string', 'scientificLatex');
    const viaText = DetEngine.evaluateExpression(res.resultText);
    assertNear(viaText, res.decimal, 1e-12, 'resultText 求值应等于 decimal');
    // formula*：approx 且可展开时才给出
    if (res.formulaText !== null) {
      assertNear(DetEngine.evaluateExpression(res.formulaText), res.decimal, 1e-9, 'formulaText 求值应等于 decimal');
      latexCheck(res.formulaLatex, 'formulaLatex(sqrt(2))');
    }
  });
  check('approx 模式：pi 矩阵', () => {
    const res = computeOk([['pi', '0'], ['0', '1']], undefined, 'pi 矩阵');
    assertEq(res.mode, 'approx', 'pi 矩阵 mode');
    assertNear(res.decimal, Math.PI, 1e-12, 'pi 矩阵 decimal');
    assertEq(res.variables.length, 0, 'pi 矩阵 variables');
    assertEq(res.constant, true, 'pi 矩阵 constant');
  });
  check('半整数幂 2^0.5 为 approx', () => {
    const res = computeOk([['2^0.5']], undefined, '2^0.5');
    assertEq(res.mode, 'approx', '2^0.5 应为 approx');
    assertNear(res.decimal, Math.SQRT2, 1e-12, '2^0.5 decimal');
  });
  check('scientificText / scientificLatex 数值一致', () => {
    const res = computeOk([['sqrt(2)']], undefined, 'sqrt(2) 1x1');
    const parsed = parseScientific(res.scientificText, 'scientificText');
    if (Number.isFinite(parsed)) {
      assertNear(parsed, res.decimal, 1e-6, 'scientificText 数值');
    } else {
      assert(/[0-9]/.test(String(res.scientificText)), `scientificText 应含数字，实际 ${show(res.scientificText)}`);
      note(`scientificText 格式无法解析为数值（${show(res.scientificText)}），仅做字符串检查。`);
    }
    latexCheck(res.scientificLatex, 'scientificLatex(sqrt(2))');
  });
  check('symbolic 模式置空 exact/decimal', () => {
    const res = computeOk([['x', '1'], ['1', 'x']], undefined, 'symbolic 2x2');
    assertResultShape(res, 'symbolic 2x2', 2);
    assertEq(res.mode, 'symbolic', 'symbolic mode');
    assertEq(res.exact, null, 'symbolic exact 应为 null');
    assertEq(res.decimal, null, 'symbolic decimal 应为 null');
    assertEq(res.constant, false, 'symbolic constant 应为 false');
    assertDeepEq(res.variables, ['x'], 'symbolic variables');
  });
});

// ---------------------------------------------------------------------------
// scientificText 解析辅助（格式契约未严格固定，尽量兼容）
function parseScientific(s, label) {
  if (typeof s !== 'string') return NaN;
  let t = s.replace(/\s+/g, '').replace(/\\times|\\cdot|\\,|×|⋅|·/g, '*').replace(/[{}]/g, '');
  let m = /^(-?[0-9]+(?:\.[0-9]+)?)\*10\^([+-]?\d+)$/.exec(t);
  if (m) return parseFloat(m[1]) * Math.pow(10, parseInt(m[2], 10));
  m = /^(-?[0-9]+(?:\.[0-9]+)?)[eE]([+-]?\d+)$/.exec(t);
  if (m) return parseFloat(m[1]) * Math.pow(10, parseInt(m[2], 10));
  return NaN;
}

// ---------------------------------------------------------------------------
group('符号行列式：已知恒等式', () => {
  check('det([[a,b],[c,d]]) = ad - bc', () => {
    const res = computeOk([['a', 'b'], ['c', 'd']], undefined, '2x2 符号');
    assertResultShape(res, '2x2 符号', 2);
    assertEq(res.mode, 'symbolic', '2x2 符号 mode');
    assertDeepEq(res.variables, ['a', 'b', 'c', 'd'], '2x2 符号 variables');
    const rng = mulberry32(0x2B2B);
    for (let k = 0; k < 15; k++) {
      const a = randInt(rng, -4, 4);
      const b = randInt(rng, -4, 4);
      const c = randInt(rng, -4, 4);
      const d = randInt(rng, -4, 4);
      const expected = a * d - b * c;
      const got = evalExprAt(res.resultText, { a, b, c, d });
      assertEq(got, expected, `ad-bc @ a=${a},b=${b},c=${c},d=${d}`);
    }
  });
  check('det([[x,1],[1,x]]) = x^2-1', () => {
    const res = computeOk([['x', '1'], ['1', 'x']], undefined, 'x^2-1');
    for (let x = -3; x <= 3; x++) {
      assertEq(evalExprAt(res.resultText, { x }), x * x - 1, `x^2-1 @ x=${x}`);
    }
    const r = computeOk([['x', '1'], ['1', 'x']], { values: { x: '7/3' } }, 'x^2-1 代入 7/3');
    assertEq(r.mode, 'exact', '代入有理数后 mode 应为 exact');
    assertExactEq(r.exact, Frac.fromString('40/9'), 'x^2-1 @ x=7/3 (49/9-1=40/9)');
  });
  check('3x3 范德蒙德 = (b-a)(c-a)(c-b)', () => {
    const entries = [['1', '1', '1'], ['a', 'b', 'c'], ['a^2', 'b^2', 'c^2']];
    const res = computeOk(entries, undefined, '范德蒙德 3x3');
    assertEq(res.mode, 'symbolic', '范德蒙德 mode');
    assertDeepEq(res.variables, ['a', 'b', 'c'], '范德蒙德 variables');
    const rng = mulberry32(0x3A3A);
    for (let k = 0; k < 10; k++) {
      let a; let b; let c;
      do {
        a = randInt(rng, -4, 4);
        b = randInt(rng, -4, 4);
        c = randInt(rng, -4, 4);
      } while (a === b || a === c || b === c);
      const expected = (b - a) * (c - a) * (c - b);
      const got = evalExprAt(res.resultText, { a, b, c });
      assertEq(got, expected, `范德蒙德 @ a=${a},b=${b},c=${c}`);
    }
    // 有理点代入（精确模式）
    const r = computeOk(entries, { values: { a: '1/2', b: '1/3', c: '1/4' } }, '范德蒙德 有理点');
    assertEq(r.mode, 'exact', '范德蒙德 有理点 mode');
    assertExactEq(r.exact, Frac.fromString('-1/288'), '范德蒙德 @ (1/2,1/3,1/4) = -1/288');
  });
  check('特征多项式矩阵 det([[x-2,-1],[-1,x-2]]) = (x-1)(x-3)', () => {
    const entries = [['x-2', '-1'], ['-1', 'x-2']];
    const res = computeOk(entries, undefined, '特征多项式');
    for (const [x, expected] of [[0, 3], [1, 0], [2, -1], [3, 0], [4, 3], [-1, 8]]) {
      assertEq(evalExprAt(res.resultText, { x }), expected, `charpoly @ x=${x}`);
    }
    const r = computeOk(entries, { values: { x: '5' } }, '特征多项式 @5');
    assertExactEq(r.exact, Frac.fromString('8/1'), 'charpoly @ x=5');
  });
  check('上三角符号矩阵 = 对角积', () => {
    const entries = [['a', '1', '2'], ['0', 'b', '3'], ['0', '0', 'c']];
    const res = computeOk(entries, undefined, '符号上三角');
    const rng = mulberry32(0x7A7A);
    for (let k = 0; k < 8; k++) {
      const a = randInt(rng, -3, 3);
      const b = randInt(rng, -3, 3);
      const c = randInt(rng, -3, 3);
      assertEq(evalExprAt(res.resultText, { a, b, c }), a * b * c, `上三角符号 @ (${a},${b},${c})`);
    }
  });
  check('标量阵 aI_n = a^n', () => {
    const r2 = computeOk([['a', '0'], ['0', 'a']], undefined, 'aI2');
    for (let a = -3; a <= 3; a++) assertEq(evalExprAt(r2.resultText, { a }), a * a, `aI2 @ a=${a}`);
    const r3 = computeOk([['a', '0', '0'], ['0', 'a', '0'], ['0', '0', 'a']], undefined, 'aI3');
    for (let a = -2; a <= 2; a++) assertEq(evalExprAt(r3.resultText, { a }), a * a * a, `aI3 @ a=${a}`);
    const exact = computeOk([['a', '0'], ['0', 'a']], { values: { a: '5/2' } }, 'aI2 @5/2');
    assertExactEq(exact.exact, Frac.fromString('25/4'), 'aI2 @ a=5/2');
  });
  check('重复行 → 0（符号）', () => {
    const res = computeOk([['a', 'b'], ['a', 'b']], undefined, '符号重复行');
    assertEq(res.mode, 'symbolic', '符号重复行 mode');
    // 语义上必须恒为 0：在若干点求值
    assertEq(evalExprAt(res.resultText, { a: 1, b: 2 }), 0, '符号重复行 resultText @ (1,2) 应为 0');
    assertEq(evalExprAt(res.resultText, { a: -3, b: 5 }), 0, '符号重复行 resultText @ (-3,5) 应为 0');
    assertEq(res.constant, true, '符号重复行 constant 应为 true');
    const res3 = computeOk([['x', '1', '2'], ['x', '1', '2'], ['3', '4', '5']], undefined, '符号重复行 3x3');
    const rng = mulberry32(0x0D0D);
    for (let k = 0; k < 5; k++) {
      const x = randInt(rng, -3, 3);
      assertEq(evalExprAt(res3.resultText, { x }), 0, `符号重复行 3x3 @ x=${x}`);
    }
    assertEq(res3.constant, true, '符号重复行 3x3 constant');
  });
  check('det([[x,0],[0,1]]) 依赖 x，constant=false', () => {
    const res = computeOk([['x', '0'], ['0', '1']], undefined, 'x*1');
    assertEq(res.constant, false, 'constant 应为 false');
    assertEq(evalExprAt(res.resultText, { x: 5 }), 5, 'det @ x=5');
  });
  check('det([[x,0],[0,0]]) 恒为 0，constant=true', () => {
    const res = computeOk([['x', '0'], ['0', '0']], undefined, '恒零');
    assertEq(res.constant, true, 'constant 应为 true');
    assertEq(evalExprAt(res.resultText, { x: 7 }), 0, 'det @ x=7');
  });
  check('隐式乘法进入矩阵：det([[2x,x],[x,3x]]) = 5x^2', () => {
    const res = computeOk([['2x', 'x'], ['x', '3x']], undefined, '隐式乘法矩阵');
    assertEq(res.mode, 'symbolic', 'mode');
    assertDeepEq(res.variables, ['x'], 'variables');
    for (let x = -3; x <= 3; x++) {
      assertEq(evalExprAt(res.resultText, { x }), 5 * x * x, `5x^2 @ x=${x}`);
    }
  });
  check('变量名：x1 / a_1 为单个变量', () => {
    const entries = [['x1', 'a_1'], ['a_1', 'x1']];
    const res = computeOk(entries, undefined, 'x1/a_1');
    assertEq(res.mode, 'symbolic', 'mode');
    assertDeepEq(res.variables, ['a_1', 'x1'], 'variables 应排序为 [a_1,x1]');
    const r = computeOk(entries, { values: { x1: '2', a_1: '3' } }, 'x1/a_1 代入');
    assertEq(r.mode, 'exact', '代入后 mode');
    assertExactEq(r.exact, Frac.fromString('-5/1'), 'x1/a_1 代入 det=4-9=-5');
  });
  check('变量名：希腊字母名 alpha/beta/theta 为单变量', () => {
    const entries = [['alpha', 'beta'], ['beta', 'alpha']];
    const res = computeOk(entries, undefined, '希腊字母');
    assertEq(res.mode, 'symbolic', '希腊字母 mode');
    assertEq(
      res.variables.length,
      2,
      `alpha/beta 应各为一个变量（不得逐字母拆成 a*l*p*h*a），实际 ${show(res.variables)}`
    );
    assertDeepEq(
      res.variables.map(canonicalVarName).sort(),
      ['alpha', 'beta'],
      '变量的规范名应语义对应 alpha/beta'
    );
    if (res.variables.some((v) => v !== canonicalVarName(v))) {
      note(
        '引擎把 alpha/beta/theta 等变量名规范化为 Unicode 希腊字母（α/β/θ），variables 与 resultText 使用规范名；options.values 的键必须用规范名，传输入原文（如 alpha）会被静默忽略（无 warning）。'
      );
    }
    const alphaKey = res.variables.find((v) => canonicalVarName(v) === 'alpha');
    const betaKey = res.variables.find((v) => canonicalVarName(v) === 'beta');
    const values = {};
    values[alphaKey] = '2';
    values[betaKey] = '1';
    const r = computeOk(entries, { values }, '希腊字母代入');
    assertEq(r.mode, 'exact', '希腊字母代入后 mode 应为 exact');
    assertExactEq(r.exact, Frac.fromString('3/1'), 'alpha^2-beta^2 @ (2,1) = 3');
    // theta 也应是单个变量
    const rt = computeOk([['theta', '0'], ['0', 'theta']], undefined, 'theta 变量');
    assertEq(rt.variables.length, 1, `theta 应为单个变量，实际 ${show(rt.variables)}`);
    assertEq(canonicalVarName(rt.variables[0]), 'theta', 'theta 变量规范名');
    assertEq(evalExprAt(rt.resultText, { [rt.variables[0]]: 3 }), 9, 'θ^2 @ θ=3');
  });
  check('变量名：ab 视为 a*b', () => {
    const res = computeOk([['ab']], undefined, 'ab 1x1');
    assertEq(res.mode, 'symbolic', 'ab mode');
    assertDeepEq(res.variables, ['a', 'b'], 'ab variables 应为 [a,b]');
    assertEq(evalExprAt(res.resultText, { a: 2, b: 3 }), 6, 'ab @ (2,3)');
    const r = computeOk([['ab']], { values: { a: '2', b: '3' } }, 'ab 代入');
    assertExactEq(r.exact, Frac.fromString('6/1'), 'ab 代入');
  });
  check('matrixLatex 含代入后的矩阵', () => {
    const res = computeOk([['x', '1'], ['1', 'x']], { values: { x: '3' } }, '代入矩阵');
    assertEq(res.mode, 'exact', 'mode');
    assertExactEq(res.exact, Frac.fromString('8/1'), 'x=3 det=8');
    assert(res.matrixLatex.includes('3'), `matrixLatex 应含代入值 3，实际 ${show(res.matrixLatex)}`);
    const body = res.matrixLatex
      .replace(/\\begin\{vmatrix\}/, '')
      .replace(/\\end\{vmatrix\}/, '');
    assert(!/(^|[\s&])x([\s&]|$)/.test(body), `矩阵单元格不应再含变量 x，实际 ${show(body)}`);
    latexCheck(res.matrixLatex, '代入后 matrixLatex');
  });
});

// ---------------------------------------------------------------------------
group('符号行列式：随机矩阵 + 代入对照', () => {
  const rng = mulberry32(0x5EED1);
  const cases = [];
  for (let idx = 0; idx < 12; idx++) {
    const n = idx < 8 ? 2 : 3;
    const vars = n === 2 ? ['a', 'b', 'c'] : ['x', 'y', 'z'];
    const matrix = genSymbolicMatrix(rng, n, vars, { maxTerms: 3, coefMax: 4 });
    const rationalPoints = [];
    for (let k = 0; k < 5; k++) {
      const fracVals = {};
      const strVals = {};
      for (const v of matrix.vars) {
        const f = new Frac(BigInt(randInt(rng, -8, 8)), BigInt(randInt(rng, 1, 7)));
        fracVals[v] = f;
        strVals[v] = fracToValueString(f);
      }
      rationalPoints.push({ fracVals, strVals });
    }
    const intPoints = [];
    for (let k = 0; k < 3; k++) {
      const values = {};
      for (const v of matrix.vars) values[v] = randInt(rng, -3, 3);
      intPoints.push(values);
    }
    cases.push({ idx, n, matrix, rationalPoints, intPoints });
  }

  cases.forEach(({ idx, n, matrix, rationalPoints, intPoints }) => {
    const label = `符号随机 #${idx} n=${n} entries=${JSON.stringify(matrix.entries)}`;
    check(label, () => {
      const res = computeOk(matrix.entries, undefined, label);
      assertResultShape(res, label, n);
      assertEq(res.mode, 'symbolic', `${label}: mode 应为 symbolic`);
      assertDeepEq(res.variables, matrix.vars, `${label}: variables`);
      assertEq(res.exact, null, `${label}: symbolic exact 应为 null`);
      assertEq(res.decimal, null, `${label}: symbolic decimal 应为 null`);

      // 1) 代入有理数（字符串形式）→ exact，对照独立分数高斯消元
      for (const { fracVals, strVals } of rationalPoints) {
        const sub = `${label} values=${JSON.stringify(strVals)}`;
        const r2 = computeOk(matrix.entries, { values: strVals }, sub);
        assertEq(r2.mode, 'exact', `${sub}: 代入有理数后 mode 应为 exact`);
        const ref = refDetPolys(matrix.termsMatrix, fracVals);
        assertExactEq(r2.exact, ref, sub);
      }

      // 2) 直接对符号 resultText 求值 → 对照同一独立参考
      for (const intValues of intPoints) {
        checkIntEvalAgainstPolys(res, matrix.termsMatrix, intValues, `${label} @ ${JSON.stringify(intValues)}`);
      }
    });
  });
});

// ---------------------------------------------------------------------------
group('符号行列式：转置不变性', () => {
  const rng = mulberry32(0x7A11);
  const cases = [];
  for (let idx = 0; idx < 5; idx++) {
    const matrix = genSymbolicMatrix(rng, 3, ['x', 'y', 'z'], { maxTerms: 2, coefMax: 3 });
    const transposed = matrix.entries[0].map((_, c) => matrix.entries.map((row) => row[c]));
    const points = [];
    for (let k = 0; k < 3; k++) {
      const values = {};
      for (const v of matrix.vars) values[v] = randInt(rng, -3, 3);
      points.push(values);
    }
    cases.push({ idx, matrix, transposed, points });
  }
  cases.forEach(({ idx, matrix, transposed, points }) => {
    const label = `符号转置 #${idx} entries=${JSON.stringify(matrix.entries)}`;
    check(label, () => {
      const a = computeOk(matrix.entries, undefined, `${label} 原矩阵`);
      const b = computeOk(transposed, undefined, `${label} 转置`);
      for (const values of points) {
        const da = evalExprAt(a.resultText, values);
        const db = evalExprAt(b.resultText, values);
        assertEq(da, db, `${label}: det(M) 与 det(M^T) 在 ${JSON.stringify(values)} 处应相等（${da} vs ${db}）`);
      }
    });
  });
});

// ---------------------------------------------------------------------------
group('LaTeX 可渲染性（assets/katex）', () => {
  const cases = [
    { label: '数值 3x3', entries: [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '10']] },
    { label: '精确分数 2x2', entries: [['1/3', '1/2'], ['1/5', '1/7']] },
    { label: '大整数 1x1', entries: [['9007199254740993']] },
    { label: 'approx sqrt2', entries: [['sqrt(2)', '0'], ['0', '1']] },
    { label: 'approx pi', entries: [['pi', '0'], ['0', '1']] },
    { label: '符号 2x2', entries: [['a', 'b'], ['c', 'd']] },
    { label: '符号 3x3', entries: [['a', '1', '0'], ['1', 'b', '1'], ['0', '1', 'c']] },
  ];
  for (const c of cases) {
    check(`KaTeX 渲染 ${c.label}`, () => {
      const res = computeOk(c.entries, undefined, `LaTeX ${c.label}`);
      latexCheck(res.matrixLatex, `${c.label} matrixLatex`);
      latexCheck(res.resultLatex, `${c.label} resultLatex`);
      if (res.decimalText !== null) {
        assert(typeof res.decimalText === 'string' && res.decimalText.length > 0, `${c.label}: decimalText 非空`);
      }
      if (res.scientificLatex !== null) latexCheck(res.scientificLatex, `${c.label} scientificLatex`);
      if (res.formulaLatex !== null) latexCheck(res.formulaLatex, `${c.label} formulaLatex`);
    });
  }
  check('LaTeX 矩阵环境标记', () => {
    const res = computeOk([['1', '2'], ['3', '4']], undefined, 'vmatrix 标记');
    assert(res.matrixLatex.startsWith('\\begin{vmatrix}'), `matrixLatex 应以 \\begin{vmatrix} 开头，实际 ${show(res.matrixLatex)}`);
    assert(res.matrixLatex.endsWith('\\end{vmatrix}'), `matrixLatex 应以 \\end{vmatrix} 结尾，实际 ${show(res.matrixLatex)}`);
  });
});

// ---------------------------------------------------------------------------
group('错误路径', () => {
  check('非方阵抛错且带 .cell', () => {
    const err = assertThrows(() => DetEngine.compute([['1', '2', '3'], ['4', '5', '6']]), '2x3 非方阵', { cell: {} });
    assert(err.cell.r >= 0 && err.cell.c >= 0, `非方阵 .cell 应为非负整数，实际 ${show(err.cell)}`);
  });
  check('1x3 非方阵抛错', () => {
    assertThrows(() => DetEngine.compute([['1', '2', '3']]), '1x3 非方阵', { cell: {} });
  });
  check('列数不一致（第二行更短）', () => {
    assertThrows(() => DetEngine.compute([['1', '2'], ['3']]), '列数不一致', { cell: {} });
  });
  check('7 阶抛错且带 .cell', () => {
    const entries = Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => '1'));
    assertThrows(() => DetEngine.compute(entries), '7x7', { cell: {} });
  });
  check('空矩阵/0 阶抛错', () => {
    assertThrows(() => DetEngine.compute([]), '空矩阵 []', { cell: {} });
    assertThrows(() => DetEngine.compute([[]]), '0 阶 [[]]', { cell: {} });
  });
  check('非法表达式单元格：.cell 精确指向 (r,c)', () => {
    const err = assertThrows(
      () => DetEngine.compute([['1', '2'], ['3', '1+']]),
      '非法表达式单元格',
      { cell: { r: 1, c: 1 } }
    );
    assert(err.message.length > 0, '错误 message 非空');
    assertThrows(
      () => DetEngine.compute([['$', '1'], ['1', '1']]),
      '非法字符在 (0,0)',
      { cell: { r: 0, c: 0 } }
    );
    assertThrows(
      () => DetEngine.compute([['1', '1'], ['1', 'sin(']]),
      '括号未闭合在 (1,1)',
      { cell: { r: 1, c: 1 } }
    );
  });
  check('除以零单元格：.cell 正确', () => {
    assertThrows(() => DetEngine.compute([['1', '2'], ['3', '1/0']]), '单元格除零', { cell: { r: 1, c: 1 } });
  });
  check('compute 不修改输入 entries', () => {
    const entries = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '10']];
    const snapshot = JSON.stringify(entries);
    DetEngine.compute(entries);
    assertEq(JSON.stringify(entries), snapshot, 'compute 不应修改输入矩阵');
    const symbolic = [['x', '1'], ['1', 'x']];
    const snap2 = JSON.stringify(symbolic);
    DetEngine.compute(symbolic);
    assertEq(JSON.stringify(symbolic), snap2, 'compute 不应修改符号矩阵输入');
  });
});

// ---------------------------------------------------------------------------
group('性能', () => {
  check('6x6 随机整数 exact 模式 < 1s', () => {
    const rng = mulberry32(0x6A6A);
    const entries = randIntMatrix(rng, 6, -99, 99);
    // 预热，避免首次编译开销干扰
    DetEngine.compute([['1', '2'], ['3', '4']]);
    const t0 = performance.now();
    const res = DetEngine.compute(entries);
    const dt = performance.now() - t0;
    console.log(`   [perf] 6x6 整数 exact: ${dt.toFixed(2)} ms`);
    assert(dt < 1000, `6x6 整数 exact 耗时 ${dt.toFixed(2)}ms，超过 1000ms 限制；entries=${JSON.stringify(entries)}`);
    assertEq(res.mode, 'exact', '6x6 mode');
    assertExactEq(res.exact, refDetFrac(fracRowMatrix(entries)), '6x6 结果');
    note(`6x6 随机整数 exact 耗时 ${dt.toFixed(2)}ms`);
  });
  check('5x5 随机整数 exact 模式 < 1s', () => {
    const rng = mulberry32(0x5A5A);
    const entries = randIntMatrix(rng, 5, -50, 50);
    const t0 = performance.now();
    const res = DetEngine.compute(entries);
    const dt = performance.now() - t0;
    console.log(`   [perf] 5x5 整数 exact: ${dt.toFixed(2)} ms`);
    assert(dt < 1000, `5x5 整数 exact 耗时 ${dt.toFixed(2)}ms，超过 1000ms 限制`);
    assertExactEq(res.exact, refDetFrac(fracRowMatrix(entries)), '5x5 结果');
  });
  check('4x4 符号范德蒙德 < 3s', () => {
    const entries = [
      ['1', '1', '1', '1'],
      ['a', 'b', 'c', 'd'],
      ['a^2', 'b^2', 'c^2', 'd^2'],
      ['a^3', 'b^3', 'c^3', 'd^3'],
    ];
    DetEngine.compute([['x', '1'], ['1', 'x']]); // 预热
    const t0 = performance.now();
    const res = DetEngine.compute(entries);
    const dt = performance.now() - t0;
    console.log(`   [perf] 4x4 符号范德蒙德: ${dt.toFixed(2)} ms`);
    assert(dt < 3000, `4x4 符号范德蒙德耗时 ${dt.toFixed(2)}ms，超过 3000ms 限制`);
    assertEq(res.mode, 'symbolic', '4x4 范德蒙德 mode');
    assertDeepEq(res.variables, ['a', 'b', 'c', 'd'], '4x4 范德蒙德 variables');
    // 在整数点验证为 ∏_{i<j}(x_j - x_i)
    const vals = [2, 5, -1, 3];
    const intValues = { a: vals[0], b: vals[1], c: vals[2], d: vals[3] };
    const fracVals = vals.map((v) => new Frac(BigInt(v)));
    const expected = vandermondeDetFrac(fracVals);
    assertEq(expected.d, 1n, '4x4 范德蒙德参考值应为整数');
    const got = evalExprAt(res.resultText, intValues);
    assertEq(got, Number(expected.n), `4x4 范德蒙德 @ ${JSON.stringify(intValues)}`);
    note(`4x4 符号范德蒙德耗时 ${dt.toFixed(2)}ms`);
  });
});

// ===========================================================================
// 6. 汇总输出
// ===========================================================================
console.log('\n==================== 汇总 ====================');
for (const g of groupStats) {
  console.log(`${g.fail === 0 ? 'OK  ' : 'FAIL'}  ${g.name}  (PASS ${g.pass} / FAIL ${g.fail})`);
}
console.log('----------------------------------------------');
console.log(`引擎：${ENGINE_PATH}`);
console.log(`PASS ${pass}   FAIL ${fail}`);
if (fail > 0) {
  console.log('\n---------------- 失败详情 ----------------');
  failures.forEach((f, i) => {
    console.log(`\n[${i + 1}] ${f.group} :: ${f.name}`);
    console.log(`    ${String(f.message).split('\n').join('\n    ')}`);
  });
}
if (notes.length > 0) {
  console.log('\n---------------- 备注 ----------------');
  notes.forEach((n) => console.log(`- ${n}`));
}
if (fail > 0) {
  console.log('\n结果：FAIL');
  process.exit(1);
} else {
  console.log('\n结果：PASS（全部通过）');
  process.exit(0);
}
