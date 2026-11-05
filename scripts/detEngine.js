/**
 * 行列式计算器引擎（纯前端、零依赖）
 *
 * 能力：
 *   1. 表达式解析：数字（含科学计数法、分数）、变量、常量 pi / e、
 *      + - * / ^、隐式乘法、sin/cos/... 等函数；
 *   2. 数值行列式：全有理数输入时用分数精确高斯消元（BigInt），否则用浮点近似；
 *   3. 符号行列式：余子式展开 + 完全展开合并同类项，输出多项式形式；
 *   4. 科学公式输出：表达式 → LaTeX（KaTeX 可渲染），也提供纯文本形式；
 *   5. 变量代入：把变量用常数表达式替换后按数值/符号规则重新计算。
 *
 * 用法：
 *   浏览器：<script src="detEngine.js"></script> 后使用 window.DetEngine
 *   Node：  const DetEngine = require('./scripts/detEngine.js')
 *
 * 主要 API：
 *   DetEngine.compute(entries, options?)         行列式完整结果（见 README 注释）
 *   DetEngine.evaluateExpression(text, values?)  表达式求数值
 *   DetEngine.parseExpression(text)              表达式 → AST
 *   DetEngine.stringify(ast)                     AST → 纯文本
 *   DetEngine.exprToLatex(ast)                   AST → LaTeX
 *   DetEngine.MAX_SIZE                           最大阶数（6）
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DetEngine = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var VERSION = '1.0.0';
    var MAX_SIZE = 6;
    var MAX_EXP = 1000;            // 乘方指数上限（避免 BigInt 爆炸）
    var MAX_MONOMIALS = 120000;    // 展开项数上限（超出则保留紧凑形式）

    /* ============================================================
     * 一、有理数（BigInt 分数，始终约分，分母为正）
     * ============================================================ */

    function bgcd(a, b) {
        if (a < 0n) a = -a;
        if (b < 0n) b = -b;
        while (b) {
            var t = a % b;
            a = b;
            b = t;
        }
        return a;
    }

    function rat(n, d) {
        n = BigInt(n);
        d = BigInt(d);
        if (d === 0n) throw detError('除数为零');
        if (d < 0n) {
            n = -n;
            d = -d;
        }
        var g = bgcd(n, d);
        if (g > 1n) {
            n /= g;
            d /= g;
        }
        return { n: n, d: d };
    }

    var R0 = rat(0, 1);
    var R1 = rat(1, 1);

    function rAdd(a, b) { return rat(a.n * b.d + b.n * a.d, a.d * b.d); }
    function rSub(a, b) { return rat(a.n * b.d - b.n * a.d, a.d * b.d); }
    function rMul(a, b) { return rat(a.n * b.n, a.d * b.d); }
    function rDiv(a, b) {
        if (b.n === 0n) throw detError('除数为零');
        return rat(a.n * b.d, a.d * b.n);
    }
    function rNeg(a) { return { n: -a.n, d: a.d }; }
    function rIsZero(a) { return a.n === 0n; }
    function rIsInt(a) { return a.d === 1n; }
    function rIsOne(a) { return a.n === 1n && a.d === 1n; }
    function rAbs(a) { return a.n < 0n ? { n: -a.n, d: a.d } : a; }
    function rToString(a) { return a.d === 1n ? a.n.toString() : a.n + '/' + a.d; }

    function rToNumber(r) {
        var n = Number(r.n);
        var d = Number(r.d);
        if (!isFinite(n) || !isFinite(d)) return NaN;
        return n / d;
    }

    function rPowInt(base, exp) {
        if (exp === 0) return R1;
        if (exp < 0) {
            if (rIsZero(base)) throw detError('零不能取负指数');
            return rDiv(R1, rPowInt(base, -exp));
        }
        var result = R1;
        var b = base;
        var e = exp;
        while (e > 0) {
            if (e & 1) result = rMul(result, b);
            b = rMul(b, b);
            e >>= 1;
        }
        return result;
    }

    function intPowBig(b, e) {
        var r = 1n;
        while (e-- > 0) r *= b;
        return r;
    }

    /** 精确求 n 的 q 次方根；不是整数则返回 null。 */
    function irootAbs(n, q) {
        if (n < 0n) n = -n;
        if (n === 0n) return 0n;
        if (q === 1) return n;
        var lo = 0n;
        var hi = 1n;
        while (intPowBig(hi, q) <= n) hi *= 2n;
        while (lo + 1n < hi) {
            var mid = (lo + hi) / 2n;
            if (intPowBig(mid, q) <= n) lo = mid;
            else hi = mid;
        }
        return intPowBig(lo, q) === n ? lo : null;
    }

    /** base^exp 若为精确有理数则返回，否则返回 null。 */
    function rPowExact(base, exp) {
        if (rIsInt(exp)) {
            var k = Number(exp.n);
            if (!Number.isSafeInteger(k) || Math.abs(k) > MAX_EXP) return null;
            return rPowInt(base, k);
        }
        var p = Number(exp.n);
        var q = Number(exp.d);
        if (!Number.isSafeInteger(p) || !Number.isSafeInteger(q) || q > 16) return null;
        if (base.n < 0n && q % 2 === 0) return null;
        var rn = irootAbs(base.n, q);
        if (rn === null) return null;
        var rd = irootAbs(base.d, q);
        if (rd === null) return null;
        var root = rat(base.n < 0n ? -rn : rn, rd);
        if (Math.abs(p) > MAX_EXP) return null;
        return rPowInt(root, p);
    }

    /* ============================================================
     * 二、表达式 AST
     *   num    { v: Rational }
     *   const  { name: 'pi' | 'e' }
     *   var    { name }
     *   add    { terms: [] }        —— 已展平，不含零项
     *   mul    { factors: [] }      —— 已展平，数值系数合并在首个因子
     *   pow    { base, exp: Rational } —— 指数必须是常数
     *   func   { name, arg }
     * ============================================================ */

    function detError(msg, extra) {
        var err = new Error(msg);
        if (extra) {
            if (extra.cell) err.cell = extra.cell;
            if (extra.position !== undefined) err.position = extra.position;
            if (extra.variable !== undefined) err.variable = extra.variable;
        }
        return err;
    }

    function Num(v) { return { t: 'num', v: v }; }
    function Var(name) { return { t: 'var', name: name }; }
    function Const(name) { return { t: 'const', name: name }; }

    function isNum(e) { return e.t === 'num'; }
    function isZeroNum(e) { return e.t === 'num' && e.v.n === 0n; }

    function mkAdd(list) {
        var flat = [];
        var sum = R0;
        var i;
        function pushTerm(t) {
            if (t.t === 'num') sum = rAdd(sum, t.v);
            else if (t.t === 'add') {
                for (var j = 0; j < t.terms.length; j++) pushTerm(t.terms[j]);
            } else {
                flat.push(t);
            }
        }
        for (i = 0; i < list.length; i++) pushTerm(list[i]);
        if (!rIsZero(sum)) flat.unshift(Num(sum));
        if (flat.length === 0) return Num(R0);
        if (flat.length === 1) return flat[0];
        return { t: 'add', terms: flat };
    }

    function mkMul(list) {
        var factors = [];
        var coef = R1;
        var i;
        for (i = 0; i < list.length; i++) {
            var e = list[i];
            if (e.t === 'mul') {
                for (var j = 0; j < e.factors.length; j++) {
                    var f = e.factors[j];
                    if (f.t === 'num') coef = rMul(coef, f.v);
                    else factors.push(f);
                }
            } else if (e.t === 'num') {
                coef = rMul(coef, e.v);
            } else {
                factors.push(e);
            }
        }
        if (rIsZero(coef)) return Num(R0);
        if (factors.length === 0) return Num(coef);
        if (factors.length === 1 && rIsOne(coef)) return factors[0];
        if (!rIsOne(coef)) factors.unshift(Num(coef));
        return { t: 'mul', factors: factors };
    }

    function mkPow(base, expAst) {
        if (expAst.t !== 'num') throw detError('指数必须是常数');
        var exp = expAst.v;
        if (rIsZero(exp)) return Num(R1);
        if (base.t === 'num') {
            var exact = rPowExact(base.v, exp);
            if (exact !== null) return Num(exact);
            return { t: 'pow', base: base, exp: exp };
        }
        if (exp.d === 1n && exp.n === 1n) return base;
        if (base.t === 'pow' && exp.d === 1n) {
            var e2 = rMul(base.exp, exp);
            return mkPow(base.base, Num(e2));
        }
        return { t: 'pow', base: base, exp: exp };
    }

    /** 常量函数在特殊点的精确折叠。 */
    function foldFuncConst(name, r) {
        var zero = rIsZero(r);
        var one = rIsOne(r);
        switch (name) {
            case 'sin':
            case 'tan':
                return zero ? R0 : null;
            case 'cos':
                return zero ? R1 : null;
            case 'exp':
                return zero ? R1 : null;
            case 'ln':
            case 'log':
            case 'log10':
                return one ? R0 : null;
            case 'abs':
                return rAbs(r);
            default:
                return null;
        }
    }

    function mkFunc(name, arg) {
        if (name === 'sqrt') return mkPow(arg, Num(rat(1, 2)));
        if (arg.t === 'num') {
            var folded = foldFuncConst(name, arg.v);
            if (folded) return Num(folded);
        }
        return { t: 'func', name: name, arg: arg };
    }

    /* ============================================================
     * 三、词法与语法分析
     * ============================================================ */

    var FUNCS = {
        sin: 1, cos: 1, tan: 1, cot: 1, sec: 1, csc: 1,
        asin: 1, acos: 1, atan: 1,
        sinh: 1, cosh: 1, tanh: 1,
        exp: 1, ln: 1, log: 1, log10: 1, sqrt: 1, abs: 1
    };

    var GREEK_MAP = {
        alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ',
        eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ',
        nu: 'ν', xi: 'ξ', omicron: 'ο', rho: 'ρ', sigma: 'σ', tau: 'τ',
        upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
        Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ',
        Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω'
    };

    var IDENT_RE = /^[A-Za-z_α-ωΑ-Ω][A-Za-z0-9_α-ωΑ-Ω]*/;
    var NUM_RE = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;

    function tokenize(text) {
        var i = 0;
        var n = text.length;
        var out = [];
        while (i < n) {
            var ch = text[i];
            if (/\s/.test(ch)) { i++; continue; }
            var rest = text.slice(i);
            var m;
            if (ch >= '0' && ch <= '9' || ch === '.') {
                m = NUM_RE.exec(rest);
                if (!m) throw detError('无法识别的字符 "' + ch + '"', { position: i });
                out.push({ type: 'num', text: m[0], start: i });
                i += m[0].length;
                continue;
            }
            if (/[A-Za-z_α-ωΑ-Ω]/.test(ch)) {
                m = IDENT_RE.exec(rest);
                out.push({ type: 'ident', text: m[0], start: i });
                i += m[0].length;
                continue;
            }
            if ('+-*/^(),'.indexOf(ch) >= 0) {
                out.push({ type: ch, text: ch, start: i });
                i++;
                continue;
            }
            throw detError('无法识别的字符 "' + ch + '"（位置 ' + (i + 1) + '）', { position: i });
        }
        return out;
    }

    function parseNumberToken(s) {
        var m = /^([0-9]*\.?[0-9]+)(?:[eE]([+-]?\d+))?$/.exec(s);
        if (!m) throw detError('无法解析数字 "' + s + '"');
        var mant = m[1];
        var exp = m[2] ? parseInt(m[2], 10) : 0;
        if (Math.abs(exp) > MAX_EXP) throw detError('数字指数过大');
        var parts = mant.split('.');
        var intPart = parts[0] || '0';
        var fracPart = parts[1] || '';
        var num = BigInt(intPart + fracPart);
        var den = 10n ** BigInt(fracPart.length);
        if (exp >= 0) num *= 10n ** BigInt(exp);
        else den *= 10n ** BigInt(-exp);
        return rat(num, den);
    }

    function Parser(text) {
        this.tokens = tokenize(text);
        this.pos = 0;
        this.text = text;
    }

    Parser.prototype.peek = function () {
        return this.tokens[this.pos] || null;
    };

    Parser.prototype.next = function () {
        return this.tokens[this.pos++] || null;
    };

    Parser.prototype.expect = function (type, what) {
        var t = this.next();
        if (!t || t.type !== type) {
            var pos = t ? t.start : this.text.length;
            throw detError('缺少 ' + what + '（位置 ' + (pos + 1) + '）', { position: pos });
        }
        return t;
    };

    Parser.prototype.parse = function () {
        if (!this.tokens.length) throw detError('表达式为空');
        var e = this.parseAdd();
        if (this.pos < this.tokens.length) {
            var t = this.tokens[this.pos];
            throw detError('表达式语法错误：多余的 "' + t.text + '"（位置 ' + (t.start + 1) + '）', { position: t.start });
        }
        return e;
    };

    Parser.prototype.parseAdd = function () {
        var e = this.parseMul();
        for (;;) {
            var t = this.peek();
            if (!t || (t.type !== '+' && t.type !== '-')) break;
            var op = this.next().type;
            var rhs = this.parseMul();
            e = op === '+' ? mkAdd([e, rhs]) : mkAdd([e, mkMul([Num(rat(-1, 1)), rhs])]);
        }
        return e;
    };

    Parser.prototype.parseMul = function () {
        var e = this.parseUnary();
        for (;;) {
            var t = this.peek();
            if (!t) break;
            if (t.type === '*') {
                this.next();
                e = mkMul([e, this.parseUnary()]);
            } else if (t.type === '/') {
                this.next();
                e = mkMul([e, mkPow(this.parseUnary(), Num(rat(-1, 1)))]);
            } else if (t.type === 'num' || t.type === 'ident' || t.type === '(') {
                e = mkMul([e, this.parseUnary()]);
            } else {
                break;
            }
        }
        return e;
    };

    Parser.prototype.parseUnary = function () {
        var t = this.peek();
        if (t && t.type === '+') {
            this.next();
            return this.parseUnary();
        }
        if (t && t.type === '-') {
            this.next();
            return mkMul([Num(rat(-1, 1)), this.parseUnary()]);
        }
        return this.parsePower();
    };

    Parser.prototype.parsePower = function () {
        var base = this.parsePrimary();
        var t = this.peek();
        if (t && t.type === '^') {
            this.next();
            var exp = this.parseUnary();
            if (exp.t !== 'num') throw detError('指数必须是常数（位置 ' + (t.start + 1) + '）', { position: t.start });
            return mkPow(base, exp);
        }
        return base;
    };

    Parser.prototype.parsePrimary = function () {
        var t = this.peek();
        if (!t) throw detError('表达式不完整');
        if (t.type === 'num') {
            this.next();
            return Num(parseNumberToken(t.text));
        }
        if (t.type === 'ident') {
            this.next();
            var name = t.text;
            if (FUNCS[name]) {
                var nt = this.peek();
                if (!nt || nt.type !== '(') {
                    throw detError('函数 ' + name + ' 缺少括号，例如 ' + name + '(x)（位置 ' + (t.start + 1) + '）', { position: t.start });
                }
                this.next();
                var arg = this.parseAdd();
                this.expect(')', '右括号');
                return mkFunc(name, arg);
            }
            if (name === 'pi' || name === 'π') return Const('pi');
            if (name === 'e') return Const('e');
            if (GREEK_MAP[name]) return Var(GREEK_MAP[name]);
            if (/^[A-Za-z]{2,}$/.test(name)) {
                // 多字母纯字母串按逐字母乘积处理：ab = a*b
                var parts = [];
                for (var i = 0; i < name.length; i++) parts.push(Var(name[i]));
                return mkMul(parts);
            }
            return Var(name);
        }
        if (t.type === '(') {
            this.next();
            var e = this.parseAdd();
            this.expect(')', '右括号');
            return e;
        }
        throw detError('表达式语法错误：意外的 "' + t.text + '"（位置 ' + (t.start + 1) + '）', { position: t.start });
    };

    function parseExpression(text) {
        if (typeof text !== 'string') throw detError('表达式必须是字符串');
        return new Parser(text).parse();
    }

    /* ============================================================
     * 四、求值
     * ============================================================ */

    var EVAL_FUNCS = {
        sin: Math.sin, cos: Math.cos, tan: Math.tan,
        cot: function (x) { return 1 / Math.tan(x); },
        sec: function (x) { return 1 / Math.cos(x); },
        csc: function (x) { return 1 / Math.sin(x); },
        asin: Math.asin, acos: Math.acos, atan: Math.atan,
        sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
        exp: Math.exp, ln: Math.log,
        log: Math.log10, log10: Math.log10,
        abs: Math.abs
    };

    function evalExpr(e, env) {
        switch (e.t) {
            case 'num':
                return rToNumber(e.v);
            case 'const':
                return e.name === 'pi' ? Math.PI : Math.E;
            case 'var':
                if (!Object.prototype.hasOwnProperty.call(env, e.name)) {
                    throw detError('变量 "' + e.name + '" 没有赋值', { variable: e.name });
                }
                return env[e.name];
            case 'add': {
                var sum = 0;
                for (var i = 0; i < e.terms.length; i++) sum += evalExpr(e.terms[i], env);
                return sum;
            }
            case 'mul': {
                var prod = 1;
                for (var j = 0; j < e.factors.length; j++) prod *= evalExpr(e.factors[j], env);
                return prod;
            }
            case 'pow':
                return Math.pow(evalExpr(e.base, env), rToNumber(e.exp));
            case 'func': {
                var fn = EVAL_FUNCS[e.name];
                if (!fn) throw detError('未知函数 ' + e.name);
                return fn(evalExpr(e.arg, env));
            }
            default:
                throw detError('未知表达式节点');
        }
    }

    function evaluateExpression(text, values) {
        return evalExpr(parseExpression(text), values || {});
    }

    /* ============================================================
     * 五、符号展开（多项式规范化）
     * ============================================================ */

    function ExpansionTooLarge() {
        var err = new Error('展开项数过多');
        err.code = 'EXPANSION_TOO_LARGE';
        return err;
    }

    function monomial(coef) {
        return { coef: coef || R1, atoms: Object.create(null) };
    }

    function atomKey(e) {
        return stringify(e);
    }

    function addAtom(m, e, exp) {
        var key = atomKey(e);
        var cur = m.atoms[key];
        if (cur) cur.exp += exp;
        else m.atoms[key] = { node: e, exp: exp };
    }

    function mulMonomial(a, b) {
        var r = monomial(rMul(a.coef, b.coef));
        var key;
        for (key in a.atoms) r.atoms[key] = { node: a.atoms[key].node, exp: a.atoms[key].exp };
        for (key in b.atoms) {
            if (r.atoms[key]) r.atoms[key].exp += b.atoms[key].exp;
            else r.atoms[key] = { node: b.atoms[key].node, exp: b.atoms[key].exp };
        }
        return r;
    }

    function mulMonomialSets(setA, setB) {
        if (setA.length * setB.length > MAX_MONOMIALS) throw ExpansionTooLarge();
        var out = [];
        for (var i = 0; i < setA.length; i++) {
            for (var j = 0; j < setB.length; j++) {
                out.push(mulMonomial(setA[i], setB[j]));
            }
        }
        return out;
    }

    function powMonomial(m, k) {
        var r = monomial(rPowInt(m.coef, k));
        for (var key in m.atoms) {
            r.atoms[key] = { node: m.atoms[key].node, exp: m.atoms[key].exp * k };
        }
        return r;
    }

    function toMonomials(e) {
        var i;
        switch (e.t) {
            case 'num':
                return [monomial(e.v)];
            case 'const':
            case 'var':
            case 'func': {
                var m = monomial(R1);
                addAtom(m, e, 1);
                return [m];
            }
            case 'add': {
                var all = [];
                for (i = 0; i < e.terms.length; i++) {
                    var part = toMonomials(e.terms[i]);
                    for (var k = 0; k < part.length; k++) all.push(part[k]);
                    if (all.length > MAX_MONOMIALS) throw ExpansionTooLarge();
                }
                return all;
            }
            case 'mul': {
                var res = [monomial(R1)];
                for (i = 0; i < e.factors.length; i++) {
                    res = mulMonomialSets(res, toMonomials(e.factors[i]));
                }
                return res;
            }
            case 'pow': {
                var exp = e.exp;
                if (exp.d !== 1n) {
                    var atomM = monomial(R1);
                    addAtom(atomM, e, 1);
                    return [atomM];
                }
                var kNum = Number(exp.n);
                if (!Number.isSafeInteger(kNum) || Math.abs(kNum) > 60) {
                    var atomM2 = monomial(R1);
                    addAtom(atomM2, e, 1);
                    return [atomM2];
                }
                if (kNum === 0) return [monomial(R1)];
                var baseMonos = toMonomials(e.base);
                if (baseMonos.length === 1) return [powMonomial(baseMonos[0], kNum)];
                if (kNum > 0 && kNum <= 12) {
                    var out = [monomial(R1)];
                    for (var t = 0; t < kNum; t++) out = mulMonomialSets(out, baseMonos);
                    return out;
                }
                var atomM3 = monomial(R1);
                addAtom(atomM3, e, 1);
                return [atomM3];
            }
            default:
                throw detError('未知表达式节点');
        }
    }

    function signature(m) {
        var keys = Object.keys(m.atoms).sort();
        var parts = [];
        for (var i = 0; i < keys.length; i++) parts.push(keys[i] + '^' + m.atoms[keys[i]].exp);
        return parts.join('|');
    }

    function combineMonomials(monos) {
        var map = Object.create(null);
        var order = [];
        for (var i = 0; i < monos.length; i++) {
            var m = monos[i];
            if (rIsZero(m.coef)) continue;
            var sig = signature(m);
            if (!map[sig]) {
                map[sig] = { coef: m.coef, atoms: m.atoms, sig: sig };
                order.push(sig);
            } else {
                map[sig].coef = rAdd(map[sig].coef, m.coef);
            }
        }
        var out = [];
        for (var j = 0; j < order.length; j++) {
            var item = map[order[j]];
            if (!rIsZero(item.coef)) out.push(item);
        }
        out.sort(function (a, b) {
            var da = totalDegree(a);
            var db = totalDegree(b);
            if (da !== db) return db - da;
            if (a.sig < b.sig) return -1;
            if (a.sig > b.sig) return 1;
            return 0;
        });
        return out;
    }

    function totalDegree(m) {
        var d = 0;
        for (var key in m.atoms) d += m.atoms[key].exp;
        return d;
    }

    function buildTerm(m) {
        var factors = [Num(m.coef)];
        var keys = Object.keys(m.atoms).sort();
        for (var i = 0; i < keys.length; i++) {
            var atom = m.atoms[keys[i]];
            factors.push(mkPow(atom.node, Num(rat(atom.exp, 1))));
        }
        return mkMul(factors);
    }

    function monomialsToExpr(monos) {
        if (!monos.length) return Num(R0);
        var terms = [];
        for (var i = 0; i < monos.length; i++) terms.push(buildTerm(monos[i]));
        if (terms.length === 1) return terms[0];
        return { t: 'add', terms: terms };
    }

    function expandExpr(e) {
        return monomialsToExpr(combineMonomials(toMonomials(e)));
    }

    /* ============================================================
     * 六、纯文本 / LaTeX 输出
     * ============================================================ */

    var GREEK_LATEX = {
        'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta',
        'ε': '\\epsilon', 'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta',
        'ι': '\\iota', 'κ': '\\kappa', 'λ': '\\lambda', 'μ': '\\mu',
        'ν': '\\nu', 'ξ': '\\xi', 'ο': '\\omicron', 'ρ': '\\rho',
        'σ': '\\sigma', 'τ': '\\tau', 'υ': '\\upsilon', 'φ': '\\phi',
        'χ': '\\chi', 'ψ': '\\psi', 'ω': '\\omega',
        'Γ': '\\Gamma', 'Δ': '\\Delta', 'Θ': '\\Theta', 'Λ': '\\Lambda',
        'Ξ': '\\Xi', 'Π': '\\Pi', 'Σ': '\\Sigma', 'Φ': '\\Phi',
        'Ψ': '\\Psi', 'Ω': '\\Omega'
    };

    function latexVarName(name) {
        if (GREEK_LATEX[name]) return GREEK_LATEX[name];
        if (/^[A-Za-z]$/.test(name)) return name;
        var m = /^([A-Za-z]+)_?([0-9]+)$/.exec(name);
        if (m) return m[1] + '_{' + m[2] + '}';
        if (/^[A-Za-z]+$/.test(name)) return '\\mathrm{' + name + '}';
        return '\\mathrm{' + name.replace(/[_^{}\\]/g, '') + '}';
    }

    function latexNum(r) {
        if (r.d === 1n) return r.n.toString();
        var sign = r.n < 0n ? '-' : '';
        var abs = sign ? { n: -r.n, d: r.d } : r;
        return sign + '\\frac{' + abs.n + '}{' + abs.d + '}';
    }

    function precedence(e) {
        if (e.t === 'add') return 1;
        if (e.t === 'mul') return 2;
        if (e.t === 'pow') return 3;
        return 4;
    }

    function stringify(e) {
        return strPrec(e, 0);
    }

    function strPrec(e, minPrec) {
        var s;
        var i;
        switch (e.t) {
            case 'num':
                s = rToString(e.v);
                break;
            case 'const':
                s = e.name === 'pi' ? 'pi' : 'e';
                break;
            case 'var':
                s = e.name;
                break;
            case 'func':
                s = e.name + '(' + strPrec(e.arg, 0) + ')';
                break;
            case 'pow': {
                var base = strPrec(e.base, 3);
                var es;
                if (e.exp.d === 1n) es = e.exp.n.toString();
                else es = '(' + rToString(e.exp) + ')';
                s = base + '^' + es;
                break;
            }
            case 'mul': {
                var parts = [];
                var neg = false;
                var start = 0;
                var first = e.factors[0];
                if (first.t === 'num') {
                    var rv = first.v;
                    if (rv.n < 0n) {
                        neg = true;
                        rv = { n: -rv.n, d: rv.d };
                    }
                    if (!(rv.n === 1n && rv.d === 1n)) parts.push(rToString(rv));
                    start = 1;
                }
                for (i = start; i < e.factors.length; i++) parts.push(strPrec(e.factors[i], 2));
                s = (neg ? '-' : '') + parts.join('*');
                break;
            }
            case 'add': {
                var chunks = [];
                for (i = 0; i < e.terms.length; i++) chunks.push(strPrec(e.terms[i], 1));
                s = chunks[0];
                for (i = 1; i < chunks.length; i++) {
                    if (chunks[i].charAt(0) === '-') s += ' - ' + chunks[i].slice(1);
                    else s += ' + ' + chunks[i];
                }
                break;
            }
            default:
                s = '?';
        }
        if (precedence(e) < minPrec) s = '(' + s + ')';
        return s;
    }

    function exprToLatex(ast) {
        return latexPrec(ast, 0);
    }

    function latexPrec(e, minPrec) {
        var s;
        var i;
        switch (e.t) {
            case 'num':
                return latexNum(e.v);
            case 'const':
                return e.name === 'pi' ? '\\pi' : 'e';
            case 'var':
                return latexVarName(e.name);
            case 'func':
                if (e.name === 'abs') return '\\left|' + latexPrec(e.arg, 0) + '\\right|';
                var fn = {
                    asin: '\\arcsin', acos: '\\arccos', atan: '\\arctan',
                    sinh: '\\sinh', cosh: '\\cosh', tanh: '\\tanh',
                    exp: '\\exp', ln: '\\ln', log: '\\log_{10}', log10: '\\log_{10}',
                    sin: '\\sin', cos: '\\cos', tan: '\\tan',
                    cot: '\\cot', sec: '\\sec', csc: '\\csc'
                }[e.name] || ('\\operatorname{' + e.name + '}');
                return fn + '\\left(' + latexPrec(e.arg, 0) + '\\right)';
            case 'pow':
                s = latexPow(e);
                break;
            case 'mul': {
                var parts = [];
                var neg = false;
                var start = 0;
                var first = e.factors[0];
                if (first.t === 'num') {
                    var rv = first.v;
                    if (rv.n < 0n) {
                        neg = true;
                        rv = { n: -rv.n, d: rv.d };
                    }
                    if (!(rv.n === 1n && rv.d === 1n)) parts.push(latexNum(rv));
                    start = 1;
                }
                for (i = start; i < e.factors.length; i++) parts.push(latexPrec(e.factors[i], 2));
                s = (neg ? '-' : '') + joinLatexFactors(parts);
                break;
            }
            case 'add': {
                var chunks = [];
                for (i = 0; i < e.terms.length; i++) chunks.push(latexPrec(e.terms[i], 1));
                s = chunks[0];
                for (i = 1; i < chunks.length; i++) {
                    if (chunks[i].charAt(0) === '-') s += ' - ' + chunks[i].slice(1);
                    else s += ' + ' + chunks[i];
                }
                break;
            }
            default:
                s = '?';
        }
        if (precedence(e) < minPrec) s = '\\left(' + s + '\\right)';
        return s;
    }

    /** 拼接 LaTeX 因子：避免 "\pi"+"x" 变成 "\pix" 这类命令名粘连。 */
    function joinLatexFactors(parts) {
        var s = '';
        for (var i = 0; i < parts.length; i++) {
            if (i > 0 && /\\[A-Za-z]+$/.test(s)) s += '\\,';
            s += parts[i];
        }
        return s;
    }

    function latexPow(e) {
        var exp = e.exp;
        var baseInner = latexPrec(e.base, 0);
        if (exp.d === 1n && exp.n === 1n) return latexPrec(e.base, 3);
        if (exp.d === 2n && exp.n === 1n) return '\\sqrt{' + baseInner + '}';
        if (exp.d === 2n && exp.n === -1n) return '\\frac{1}{\\sqrt{' + baseInner + '}}';
        if (exp.n < 0n) {
            var p = -exp.n;
            var basePart = latexPrec(e.base, 3);
            if (p === 1n) return '\\frac{1}{' + basePart + '}';
            return '\\frac{1}{' + basePart + '^{' + p.toString() + '}}';
        }
        var base = latexPrec(e.base, 3);
        if (exp.d === 1n) return base + '^{' + exp.n.toString() + '}';
        return base + '^{\\frac{' + exp.n + '}{' + exp.d + '}}';
    }

    /** 行列式矩阵的 LaTeX（\begin{vmatrix}...\end{vmatrix}）。 */
    function matrixLatexOf(entryLatexRows) {
        var rows = [];
        for (var r = 0; r < entryLatexRows.length; r++) rows.push(entryLatexRows[r].join(' & '));
        return '\\begin{vmatrix} ' + rows.join(' \\\\ ') + ' \\end{vmatrix}';
    }

    /* ============================================================
     * 七、行列式
     * ============================================================ */

    function detExact(m) {
        var n = m.length;
        var a = [];
        var i, j, k;
        for (i = 0; i < n; i++) a.push(m[i].slice());
        var det = R1;
        for (k = 0; k < n; k++) {
            var piv = -1;
            for (i = k; i < n; i++) {
                if (!rIsZero(a[i][k])) { piv = i; break; }
            }
            if (piv < 0) return R0;
            if (piv !== k) {
                var tmp = a[k]; a[k] = a[piv]; a[piv] = tmp;
                det = rNeg(det);
            }
            var p = a[k][k];
            det = rMul(det, p);
            for (i = k + 1; i < n; i++) {
                var f = rDiv(a[i][k], p);
                for (j = k; j < n; j++) a[i][j] = rSub(a[i][j], rMul(f, a[k][j]));
            }
        }
        return det;
    }

    function detNumeric(m) {
        var n = m.length;
        var a = [];
        var i, j, k;
        for (i = 0; i < n; i++) a.push(m[i].slice());
        var det = 1;
        for (k = 0; k < n; k++) {
            var piv = k;
            var max = Math.abs(a[k][k]);
            for (i = k + 1; i < n; i++) {
                var v = Math.abs(a[i][k]);
                if (v > max) { max = v; piv = i; }
            }
            if (max === 0) return 0;
            if (piv !== k) {
                var tmp = a[k]; a[k] = a[piv]; a[piv] = tmp;
                det = -det;
            }
            var p = a[k][k];
            det *= p;
            for (i = k + 1; i < n; i++) {
                var f = a[i][k] / p;
                for (j = k + 1; j < n; j++) a[i][j] -= f * a[k][j];
            }
        }
        return det;
    }

    /** 余子式展开（不展开乘积，交给 expandExpr 统一处理）。 */
    function detSymbolic(m) {
        var n = m.length;
        if (n === 1) return m[0][0];
        var terms = [];
        for (var j = 0; j < n; j++) {
            var minor = [];
            for (var i = 1; i < n; i++) {
                var row = [];
                for (var k = 0; k < n; k++) {
                    if (k !== j) row.push(m[i][k]);
                }
                minor.push(row);
            }
            var term = mkMul([m[0][j], detSymbolic(minor)]);
            if (j % 2 === 1) term = mkMul([Num(rat(-1, 1)), term]);
            terms.push(term);
        }
        return mkAdd(terms);
    }

    /* ============================================================
     * 八、数字格式化（小数 / 科学计数法）
     * ============================================================ */

    function trimFixed(s) {
        if (s.indexOf('.') >= 0) {
            s = s.replace(/0+$/, '');
            s = s.replace(/\.$/, '');
        }
        return s;
    }

    function trimNumberString(s) {
        if (s.indexOf('e') >= 0 || s.indexOf('E') >= 0) {
            var p = s.split(/[eE]/);
            return trimFixed(p[0]) + 'e' + p[1];
        }
        return trimFixed(s);
    }

    function formatDecimal(x) {
        if (x === null || x === undefined || !isFinite(x)) return null;
        if (x === 0) return '0';
        var abs = Math.abs(x);
        var s;
        if (abs >= 1e16 || abs < 1e-6) {
            s = x.toExponential(12);
        } else {
            s = x.toPrecision(13);
        }
        return trimNumberString(s);
    }

    function scientificParts(x) {
        if (x === 0 || !isFinite(x)) return null;
        var sign = x < 0 ? '-' : '';
        var abs = Math.abs(x);
        var e = Math.floor(Math.log10(abs));
        var m = abs / Math.pow(10, e);
        m = Number(m.toPrecision(7));
        if (m >= 10) { m /= 10; e += 1; }
        if (m < 1) { m *= 10; e -= 1; }
        return { sign: sign, mantissa: String(m), exp: e };
    }

    function formatScientificText(x) {
        var p = scientificParts(x);
        return p ? p.sign + p.mantissa + 'e' + p.exp : null;
    }

    function formatScientificLatex(x) {
        var p = scientificParts(x);
        if (!p) return null;
        return p.sign + p.mantissa + '\\times 10^{' + p.exp + '}';
    }

    /* ============================================================
     * 九、工具：变量收集 / 代入
     * ============================================================ */

    function collectVars(e, out) {
        switch (e.t) {
            case 'var':
                out[e.name] = true;
                break;
            case 'add':
                for (var i = 0; i < e.terms.length; i++) collectVars(e.terms[i], out);
                break;
            case 'mul':
                for (var j = 0; j < e.factors.length; j++) collectVars(e.factors[j], out);
                break;
            case 'pow':
                collectVars(e.base, out);
                break;
            case 'func':
                collectVars(e.arg, out);
                break;
            default:
                break;
        }
        return out;
    }

    function hasFuncNode(e) {
        switch (e.t) {
            case 'func':
                return true;
            case 'add':
                for (var i = 0; i < e.terms.length; i++) if (hasFuncNode(e.terms[i])) return true;
                return false;
            case 'mul':
                for (var j = 0; j < e.factors.length; j++) if (hasFuncNode(e.factors[j])) return true;
                return false;
            case 'pow':
                return hasFuncNode(e.base);
            default:
                return false;
        }
    }

    function substituteVars(e, map) {
        switch (e.t) {
            case 'var':
                return Object.prototype.hasOwnProperty.call(map, e.name) ? map[e.name] : e;
            case 'add': {
                var terms = [];
                for (var i = 0; i < e.terms.length; i++) terms.push(substituteVars(e.terms[i], map));
                return mkAdd(terms);
            }
            case 'mul': {
                var factors = [];
                for (var j = 0; j < e.factors.length; j++) factors.push(substituteVars(e.factors[j], map));
                return mkMul(factors);
            }
            case 'pow':
                return mkPow(substituteVars(e.base, map), Num(e.exp));
            case 'func':
                return mkFunc(e.name, substituteVars(e.arg, map));
            default:
                return e;
        }
    }

    /* ============================================================
     * 十、对外主入口
     * ============================================================ */

    function normalizeEntries(entries) {
        if (!Array.isArray(entries) || entries.length === 0) {
            throw detError('矩阵为空', { cell: { r: 0, c: 0 } });
        }
        var n = entries.length;
        if (n > MAX_SIZE) throw detError('最多支持 ' + MAX_SIZE + ' 阶矩阵', { cell: { r: 0, c: 0 } });
        var out = [];
        for (var r = 0; r < n; r++) {
            var row = entries[r];
            if (!Array.isArray(row) || row.length !== n) {
                throw detError('矩阵必须是方阵：第 ' + (r + 1) + ' 行的列数与阶数不一致', { cell: { r: r, c: 0 } });
            }
            var outRow = [];
            for (var c = 0; c < n; c++) {
                var v = row[c];
                if (v === null || v === undefined) v = '';
                if (typeof v !== 'string') {
                    if (typeof v === 'number' && isFinite(v)) v = String(v);
                    else throw detError('第 ' + (r + 1) + ' 行第 ' + (c + 1) + ' 列不是合法的表达式', { cell: { r: r, c: c } });
                }
                outRow.push(v.trim());
            }
            out.push(outRow);
        }
        return out;
    }

    function cellError(err, r, c) {
        if (!err.cell) err.cell = { r: r, c: c };
        return err;
    }

    /**
     * 计算行列式。
     * @param {string[][]} entries  n×n 表达式字符串（空串按 0 处理）
     * @param {{values?: Object<string,string>}} [options] 变量代入值（常数表达式）
     * @returns {Object} 结果对象，字段见文件头注释
     */
    function compute(entries, options) {
        options = options || {};
        var raw = normalizeEntries(entries);
        var n = raw.length;
        var r, c, i, j;

        // 1) 解析每个单元格
        var parsed = [];
        var originalVars = Object.create(null);
        for (r = 0; r < n; r++) {
            var row = [];
            for (c = 0; c < n; c++) {
                var text = raw[r][c];
                var ast;
                if (text === '') {
                    ast = Num(R0);
                } else {
                    try {
                        ast = parseExpression(text);
                    } catch (err) {
                        throw cellError(err, r, c);
                    }
                }
                row.push(ast);
                collectVars(ast, originalVars);
            }
            parsed.push(row);
        }
        var variables = Object.keys(originalVars).sort();

        // 2) 变量代入（只代入用户给出的变量）
        if (options.values) {
            var valueMap = Object.create(null);
            for (var name in options.values) {
                if (!Object.prototype.hasOwnProperty.call(options.values, name)) continue;
                var vs = options.values[name];
                if (vs === '' || vs === null || vs === undefined) continue;
                var valAst = parseExpression(String(vs));
                var vvars = Object.keys(collectVars(valAst, Object.create(null)));
                if (vvars.length) {
                    throw detError('变量 ' + name + ' 的代入值必须是常数：' + vs);
                }
                valueMap[name] = valAst;
            }
            for (r = 0; r < n; r++) {
                for (c = 0; c < n; c++) parsed[r][c] = substituteVars(parsed[r][c], valueMap);
            }
        }

        // 3) 分类：是否仍含变量、是否全为有理数
        var remainingVars = Object.create(null);
        var allRational = true;
        for (r = 0; r < n; r++) {
            for (c = 0; c < n; c++) {
                collectVars(parsed[r][c], remainingVars);
                if (parsed[r][c].t !== 'num') allRational = false;
            }
        }
        var remaining = Object.keys(remainingVars);

        var matrixLatex = matrixLatexOf(parsed.map(function (row) {
            return row.map(function (e) { return exprToLatex(e); });
        }));
        var warnings = [];

        // 4) 数值精确模式
        if (remaining.length === 0 && allRational) {
            var rationalMatrix = [];
            for (r = 0; r < n; r++) {
                var rr = [];
                for (c = 0; c < n; c++) rr.push(parsed[r][c].v);
                rationalMatrix.push(rr);
            }
            var detR = detExact(rationalMatrix);
            var decimal = rToNumber(detR);
            var decimalText;
            if (detR.d === 1n && detR.n.toString().replace('-', '').length <= 21) {
                decimalText = detR.n.toString();
            } else {
                decimalText = formatDecimal(decimal);
            }
            return {
                n: n,
                mode: 'exact',
                variables: variables,
                matrixLatex: matrixLatex,
                resultLatex: latexNum(detR),
                resultText: rToString(detR),
                exact: { n: detR.n.toString(), d: detR.d.toString() },
                decimal: isFinite(decimal) ? decimal : null,
                decimalText: decimalText,
                scientificText: formatScientificText(decimal),
                scientificLatex: formatScientificLatex(decimal),
                formulaLatex: null,
                formulaText: null,
                constant: true,
                warnings: warnings
            };
        }

        // 5) 符号模式：余子式展开 + 完全展开合并同类项
        if (remaining.length > 0) {
            var detExpr = detSymbolic(parsed);
            var resultExpr;
            try {
                resultExpr = expandExpr(detExpr);
            } catch (err) {
                if (err && err.code === 'EXPANSION_TOO_LARGE') {
                    resultExpr = detExpr;
                    warnings.push('结果展开项数过多，已保留未完全展开的形式。');
                } else {
                    throw err;
                }
            }
            var resultVars = Object.keys(collectVars(resultExpr, Object.create(null)));
            if (hasFuncNode(resultExpr)) {
                warnings.push('结果包含函数项，未做三角恒等式化简。');
            }
            return {
                n: n,
                mode: 'symbolic',
                variables: variables,
                matrixLatex: matrixLatex,
                resultLatex: exprToLatex(resultExpr),
                resultText: stringify(resultExpr),
                exact: null,
                decimal: null,
                decimalText: null,
                scientificText: null,
                scientificLatex: null,
                formulaLatex: null,
                formulaText: null,
                constant: resultVars.length === 0,
                warnings: warnings
            };
        }

        // 6) 无变量但含函数/无理数：浮点近似 + 精确表达式（可行时）
        var numericMatrix = [];
        for (r = 0; r < n; r++) {
            var nr = [];
            for (c = 0; c < n; c++) {
                var val;
                try {
                    val = evalExpr(parsed[r][c], {});
                } catch (err) {
                    throw cellError(err, r, c);
                }
                if (!isFinite(val)) {
                    throw cellError(detError('第 ' + (r + 1) + ' 行第 ' + (c + 1) + ' 列无法求值（可能超出定义域，例如负数开平方）'), r, c);
                }
                nr.push(val);
            }
            numericMatrix.push(nr);
        }
        var approx = detNumeric(numericMatrix);
        var formulaLatex = null;
        var formulaText = null;
        try {
            var symExpr = expandExpr(detSymbolic(parsed));
            formulaLatex = exprToLatex(symExpr);
            formulaText = stringify(symExpr);
        } catch (err2) {
            if (!(err2 && err2.code === 'EXPANSION_TOO_LARGE')) throw err2;
            warnings.push('精确表达式过于复杂，仅给出近似值。');
        }
        if (!formulaLatex) warnings.push('矩阵包含函数或无理常数，结果为近似值。');
        return {
            n: n,
            mode: 'approx',
            variables: variables,
            matrixLatex: matrixLatex,
            resultLatex: formulaLatex || formatDecimal(approx) || '?',
            resultText: formulaText || formatDecimal(approx) || '?',
            exact: null,
            decimal: isFinite(approx) ? approx : null,
            decimalText: formatDecimal(approx),
            scientificText: formatScientificText(approx),
            scientificLatex: formatScientificLatex(approx),
            formulaLatex: formulaLatex,
            formulaText: formulaText,
            constant: true,
            warnings: warnings
        };
    }

    return {
        version: VERSION,
        MAX_SIZE: MAX_SIZE,
        compute: compute,
        parseExpression: parseExpression,
        evaluateExpression: evaluateExpression,
        stringify: stringify,
        exprToLatex: exprToLatex
    };
});
