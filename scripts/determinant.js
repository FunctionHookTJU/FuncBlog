/**
 * 行列式计算器页面交互
 *
 * 依赖：
 *   ../scripts/detEngine.js  —— DetEngine.compute / evaluateExpression / parseExpression
 *   ../assets/katex/katex.min.js —— 公式渲染（缺失时自动退化为纯文本）
 *
 * 结构：
 *   状态 state = { n, cells }  —— 单元格原始输入文本
 *   每次输入变化（防抖 280ms）或点击「计算」都会重算并渲染
 */
(function () {
    'use strict';

    var MIN_SIZE = 2;
    var MAX_SIZE = 6;
    var DEBOUNCE_MS = 280;

    var EXAMPLES = {
        numeric: {
            n: 3,
            cells: [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '10']]
        },
        symbolic: {
            n: 2,
            cells: [['a', 'b'], ['c', 'd']]
        },
        vandermonde: {
            n: 4,
            cells: [
                ['1', '1', '1', '1'],
                ['a', 'b', 'c', 'd'],
                ['a^2', 'b^2', 'c^2', 'd^2'],
                ['a^3', 'b^3', 'c^3', 'd^3']
            ]
        },
        charpoly: {
            n: 3,
            cells: [['x', '-1', '0'], ['0', 'x', '-1'], ['2', '1', 'x+1']]
        },
        triangular: {
            n: 3,
            cells: [['a', 'b', 'c'], ['0', 'd', 'e'], ['0', '0', 'f']]
        },
        trig: {
            n: 2,
            cells: [['sin(x)', '1'], ['1', 'cos(x)']]
        }
    };

    var state = { n: 3, cells: [] };
    var current = null;
    var timer = null;
    var copyHintTimer = null;

    var el = {};

    /* ============================ 工具函数 ============================ */

    function $(id) {
        return document.getElementById(id);
    }

    function makeCells(n) {
        var out = [];
        for (var r = 0; r < n; r++) {
            var row = [];
            for (var c = 0; c < n; c++) row.push('');
            out.push(row);
        }
        return out;
    }

    function cloneCells(cells) {
        return cells.map(function (row) { return row.slice(); });
    }

    function resizeCells(cells, n) {
        var out = makeCells(n);
        for (var r = 0; r < n; r++) {
            for (var c = 0; c < n; c++) {
                if (cells[r] && cells[r][c] !== undefined) out[r][c] = cells[r][c];
            }
        }
        return out;
    }

    /** 公式渲染；KaTeX 缺失或渲染失败时退化为纯文本。 */
    function renderLatex(target, latex, fallbackText, displayMode) {
        target.textContent = '';
        if (window.katex && typeof window.katex.render === 'function' && latex) {
            try {
                window.katex.render(latex, target, {
                    displayMode: displayMode !== false,
                    throwOnError: false,
                    strict: 'ignore'
                });
                return;
            } catch (err) {
                /* 继续走纯文本兜底 */
            }
        }
        target.textContent = fallbackText || latex || '';
    }

    function copyText(text) {
        return new Promise(function (resolve, reject) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(resolve, function () {
                    fallbackCopy(text) ? resolve() : reject(new Error('复制失败'));
                });
                return;
            }
            fallbackCopy(text) ? resolve() : reject(new Error('复制失败'));
        });
    }

    function fallbackCopy(text) {
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            var ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return ok;
        } catch (err) {
            return false;
        }
    }

    function showCopyHint(text) {
        if (!el.copyHint) return;
        el.copyHint.textContent = text;
        if (copyHintTimer) clearTimeout(copyHintTimer);
        copyHintTimer = setTimeout(function () {
            el.copyHint.textContent = '';
        }, 1600);
    }

    /* ============================ 矩阵输入区 ============================ */

    function renderGrid() {
        var n = state.n;
        el.matrixSize.textContent = String(n);
        el.sizeDec.disabled = n <= MIN_SIZE;
        el.sizeInc.disabled = n >= MAX_SIZE;
        el.matrixGrid.style.gridTemplateColumns = 'repeat(' + n + ', minmax(' + (n >= 6 ? 48 : 58) + 'px, 108px))';
        el.matrixGrid.style.maxWidth = (n * 118) + 'px';
        el.matrixGrid.textContent = '';

        for (var r = 0; r < n; r++) {
            for (var c = 0; c < n; c++) {
                var input = document.createElement('input');
                input.type = 'text';
                input.className = 'matrix-cell';
                input.value = state.cells[r][c] || '';
                input.placeholder = '0';
                input.autocomplete = 'off';
                input.spellcheck = false;
                input.setAttribute('inputmode', 'text');
                input.setAttribute('aria-label', '第 ' + (r + 1) + ' 行第 ' + (c + 1) + ' 列');
                input.dataset.r = String(r);
                input.dataset.c = String(c);

                input.addEventListener('input', onCellInput);
                input.addEventListener('keydown', onCellKeydown);
                el.matrixGrid.appendChild(input);
            }
        }
    }

    function focusCell(r, c) {
        var node = el.matrixGrid.querySelector('.matrix-cell[data-r="' + r + '"][data-c="' + c + '"]');
        if (node) {
            node.focus();
            if (node.select) node.select();
        }
    }

    function onCellInput(event) {
        var input = event.target;
        var r = parseInt(input.dataset.r, 10);
        var c = parseInt(input.dataset.c, 10);
        state.cells[r][c] = input.value;
        input.classList.remove('invalid');
        scheduleCompute();
    }

    function onCellKeydown(event) {
        var input = event.target;
        var r = parseInt(input.dataset.r, 10);
        var c = parseInt(input.dataset.c, 10);
        var n = state.n;

        if (event.key === 'ArrowRight' && c < n - 1) {
            event.preventDefault();
            focusCell(r, c + 1);
        } else if (event.key === 'ArrowLeft' && c > 0) {
            event.preventDefault();
            focusCell(r, c - 1);
        } else if (event.key === 'ArrowDown' && r < n - 1) {
            event.preventDefault();
            focusCell(r + 1, c);
        } else if (event.key === 'ArrowUp' && r > 0) {
            event.preventDefault();
            focusCell(r - 1, c);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            if (r === n - 1 && c === n - 1) {
                computeNow();
                input.blur();
            } else if (c < n - 1) {
                focusCell(r, c + 1);
            } else {
                focusCell(r + 1, 0);
            }
        }
    }

    function setSize(n) {
        n = Math.max(MIN_SIZE, Math.min(MAX_SIZE, n));
        if (n === state.n) return;
        state.cells = resizeCells(state.cells, n);
        state.n = n;
        renderGrid();
        computeNow();
    }

    function applyExample(name) {
        var example = EXAMPLES[name];
        if (!example) return;
        state.n = example.n;
        state.cells = cloneCells(example.cells);
        renderGrid();
        resetSubstitutePanel();
        computeNow();
    }

    function randomExample() {
        var n = 4;
        var cells = [];
        for (var r = 0; r < n; r++) {
            var row = [];
            for (var c = 0; c < n; c++) {
                row.push(String(Math.floor(Math.random() * 19) - 9));
            }
            cells.push(row);
        }
        state.n = n;
        state.cells = cells;
        renderGrid();
        resetSubstitutePanel();
        computeNow();
    }

    function clearCells() {
        state.cells = makeCells(state.n);
        renderGrid();
        el.resultBody.hidden = true;
        el.resultEmpty.hidden = false;
        el.modeBadge.hidden = true;
        el.errorBox.hidden = true;
        current = null;
        el.matrixPreview.innerHTML = '<span class="preview-empty">输入矩阵后在这里预览</span>';
        resetSubstitutePanel();
        focusCell(0, 0);
    }

    /* ============================ 计算与渲染 ============================ */

    function scheduleCompute() {
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
            timer = null;
            computeNow();
        }, DEBOUNCE_MS);
    }

    function readCells() {
        var n = state.n;
        var cells = [];
        for (var r = 0; r < n; r++) {
            var row = [];
            for (var c = 0; c < n; c++) row.push(state.cells[r][c] || '');
            cells.push(row);
        }
        return cells;
    }

    function clearInvalidMarks() {
        var nodes = el.matrixGrid.querySelectorAll('.matrix-cell.invalid');
        for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove('invalid');
    }

    function showError(err) {
        clearInvalidMarks();
        var message = err && err.message ? err.message : '无法计算，请检查矩阵输入。';
        if (err && err.cell) {
            message += '（第 ' + (err.cell.r + 1) + ' 行第 ' + (err.cell.c + 1) + ' 列）';
            var node = el.matrixGrid.querySelector(
                '.matrix-cell[data-r="' + err.cell.r + '"][data-c="' + err.cell.c + '"]'
            );
            if (node) node.classList.add('invalid');
        }
        el.errorBox.textContent = message;
        el.errorBox.hidden = false;
        el.resultBody.hidden = true;
        el.resultEmpty.hidden = false;
        el.resultEmpty.textContent = '修正上面的输入后会自动重新计算。';
        el.modeBadge.hidden = true;
        el.matrixPreview.innerHTML = '<span class="preview-empty">矩阵存在语法错误，暂时无法预览。</span>';
        resetSubstitutePanel();
        current = null;
    }

    function computeNow() {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        var cells = readCells();
        var result;
        try {
            result = window.DetEngine.compute(cells);
        } catch (err) {
            showError(err);
            return;
        }
        current = result;
        clearInvalidMarks();
        el.errorBox.hidden = true;
        el.resultEmpty.hidden = true;
        el.resultBody.hidden = false;
        renderPreview(result);
        renderResult(result);
        renderSubstitutePanel(result);
        // 矩阵预览的矩阵可能因为阶数/内容变化而改变
    }

    function renderPreview(result) {
        renderLatex(el.matrixPreview, result.matrixLatex, result.resultText);
    }

    function modeLabel(result) {
        if (result.mode === 'exact') return { text: '数值 · 精确', cls: 'exact' };
        if (result.mode === 'approx') return { text: '数值 · 近似', cls: 'approx' };
        return { text: '代数公式', cls: 'symbolic' };
    }

    function addMetaRow(label, value, options) {
        options = options || {};
        var row = document.createElement('div');
        row.className = 'meta-row';
        var labelNode = document.createElement('span');
        labelNode.className = 'meta-label';
        labelNode.textContent = label;
        var valueNode = document.createElement('span');
        valueNode.className = 'meta-value' + (options.latex ? ' latex-value' : '');
        row.appendChild(labelNode);
        row.appendChild(valueNode);
        el.resultMeta.appendChild(row);
        if (options.latex) {
            renderLatex(valueNode, value, options.fallback, false);
        } else {
            valueNode.textContent = options.fallback !== undefined ? options.fallback : value;
        }
        return row;
    }

    /** 只在数量级确实需要科学计数法时才展示那一行。 */
    function shouldShowScientific(value) {
        if (value === null || value === undefined || value === 0 || !isFinite(value)) return false;
        var abs = Math.abs(value);
        return abs >= 1e5 || abs < 1e-3;
    }

    function renderResult(result) {
        var badge = modeLabel(result);
        el.modeBadge.textContent = badge.text;
        el.modeBadge.className = 'mode-badge ' + badge.cls;
        el.modeBadge.hidden = false;

        renderLatex(
            el.resultDisplay,
            '\\det A = ' + result.resultLatex,
            'det A = ' + result.resultText
        );

        el.resultMeta.textContent = '';

        if (result.mode === 'exact') {
            var isInteger = result.exact && result.exact.d === '1';
            if (!isInteger) addMetaRow('精确值', null, { fallback: result.resultText });
            if (result.decimalText !== null && result.decimalText !== result.resultText) {
                addMetaRow('小数', null, { fallback: result.decimalText });
            }
            if (shouldShowScientific(result.decimal)) {
                addMetaRow('科学计数法', result.scientificLatex, {
                    latex: true,
                    fallback: result.scientificText
                });
            }
        } else if (result.mode === 'approx') {
            if (result.decimalText !== null) {
                addMetaRow('近似值', null, { fallback: result.decimalText });
            }
            if (shouldShowScientific(result.decimal)) {
                addMetaRow('科学计数法', result.scientificLatex, {
                    latex: true,
                    fallback: result.scientificText
                });
            }
            if (result.formulaText) {
                addMetaRow('精确表达式', null, { fallback: result.formulaText });
            }
        } else {
            addMetaRow('变量', null, {
                fallback: result.variables.length ? result.variables.join(', ') : '无（结果与变量无关）'
            });
            addMetaRow('纯文本形式', null, { fallback: result.resultText });
            if (result.constant) {
                addMetaRow('说明', null, { fallback: '结果与变量无关，无论变量取何值行列式都相同。' });
            }
        }

        el.warnings.textContent = '';
        if (result.warnings && result.warnings.length) {
            for (var i = 0; i < result.warnings.length; i++) {
                var item = document.createElement('div');
                item.className = 'warning-item';
                item.textContent = '⚠️ ' + result.warnings[i];
                el.warnings.appendChild(item);
            }
        }

        el.copyLatex.disabled = false;
        el.copyText.disabled = false;
        el.copyHint.textContent = '';
    }

    /* ============================ 变量代入面板 ============================ */

    function resetSubstitutePanel() {
        el.substituteSection.hidden = true;
        el.varInputs.textContent = '';
        el.substituteResult.hidden = true;
        el.substituteResult.textContent = '';
    }

    function renderSubstitutePanel(result) {
        if (!result || result.mode !== 'symbolic' || !result.variables.length) {
            resetSubstitutePanel();
            return;
        }
        el.substituteSection.hidden = false;
        el.varInputs.textContent = '';
        for (var i = 0; i < result.variables.length; i++) {
            var name = result.variables[i];
            var field = document.createElement('label');
            field.className = 'var-field';
            var nameNode = document.createElement('span');
            nameNode.className = 'var-name';
            nameNode.textContent = name;
            var input = document.createElement('input');
            input.type = 'text';
            input.value = '1';
            input.autocomplete = 'off';
            input.spellcheck = false;
            input.dataset.var = name;
            input.setAttribute('aria-label', '变量 ' + name + ' 的代入值');
            field.appendChild(nameNode);
            field.appendChild(input);
            el.varInputs.appendChild(field);
        }
        el.substituteResult.hidden = true;
        el.substituteResult.textContent = '';
    }

    function doSubstitute() {
        if (!current || current.mode !== 'symbolic') return;
        var inputs = el.varInputs.querySelectorAll('input[data-var]');
        var values = {};
        for (var i = 0; i < inputs.length; i++) {
            var name = inputs[i].dataset.var;
            var value = inputs[i].value.trim();
            if (value !== '') values[name] = value;
        }
        var result;
        try {
            result = window.DetEngine.compute(readCells(), { values: values });
        } catch (err) {
            el.substituteResult.hidden = false;
            el.substituteResult.textContent = err && err.message ? err.message : '代入计算失败。';
            return;
        }
        el.substituteResult.hidden = false;
        el.substituteResult.textContent = '';

        var display = document.createElement('div');
        el.substituteResult.appendChild(display);
        var hasRemaining = result.mode === 'symbolic';
        if (hasRemaining) {
            renderLatex(display, '\\det A = ' + result.resultLatex, 'det A = ' + result.resultText);
            var restNote = document.createElement('div');
            restNote.className = 'substitute-note';
            restNote.textContent = '仍有变量未代入：' + result.variables.join('、') + '；请为它们填上数值。';
            el.substituteResult.appendChild(restNote);
        } else {
            renderLatex(display, '\\det A = ' + result.resultLatex, 'det A = ' + result.resultText);
            var note = document.createElement('div');
            note.className = 'substitute-note';
            if (result.mode === 'exact') {
                note.textContent = '精确值：' + result.resultText;
                if (result.decimalText !== null && result.decimalText !== result.resultText) {
                    note.textContent += '（约 ' + result.decimalText + '）';
                }
            } else {
                note.textContent = '近似值：' + (result.decimalText !== null ? result.decimalText : '—');
                if (result.formulaText) note.textContent += '；精确表达式：' + result.formulaText;
            }
            el.substituteResult.appendChild(note);
        }
    }

    /* ============================ 初始化 ============================ */

    function init() {
        el = {
            matrixGrid: $('matrix-grid'),
            matrixSize: $('matrix-size'),
            sizeDec: $('size-dec'),
            sizeInc: $('size-inc'),
            calcBtn: $('calc-btn'),
            clearBtn: $('clear-btn'),
            matrixPreview: $('matrix-preview'),
            errorBox: $('error-box'),
            resultEmpty: $('result-empty'),
            resultBody: $('result-body'),
            resultDisplay: $('result-display'),
            resultMeta: $('result-meta'),
            modeBadge: $('mode-badge'),
            copyLatex: $('copy-latex'),
            copyText: $('copy-text'),
            copyHint: $('copy-hint'),
            warnings: $('warnings'),
            substituteSection: $('substitute-section'),
            varInputs: $('var-inputs'),
            substituteBtn: $('substitute-btn'),
            substituteResult: $('substitute-result')
        };

        if (!window.DetEngine) {
            el.errorBox.hidden = false;
            el.errorBox.textContent = '计算引擎加载失败，请刷新页面重试。';
            return;
        }

        // 默认展示一个可以直接看到结果的数值示例
        state.n = EXAMPLES.numeric.n;
        state.cells = cloneCells(EXAMPLES.numeric.cells);
        renderGrid();

        el.sizeDec.addEventListener('click', function () { setSize(state.n - 1); });
        el.sizeInc.addEventListener('click', function () { setSize(state.n + 1); });
        el.calcBtn.addEventListener('click', computeNow);
        el.clearBtn.addEventListener('click', clearCells);
        el.substituteBtn.addEventListener('click', doSubstitute);

        var exampleBtns = document.querySelectorAll('.example-btn');
        for (var i = 0; i < exampleBtns.length; i++) {
            exampleBtns[i].addEventListener('click', function (event) {
                var name = event.currentTarget.dataset.example;
                if (name === 'random') randomExample();
                else applyExample(name);
            });
        }

        el.copyLatex.addEventListener('click', function () {
            if (!current) return;
            copyText('\\det A = ' + current.resultLatex).then(function () {
                showCopyHint('LaTeX 已复制');
            }, function () {
                showCopyHint('复制失败，请手动选择公式');
            });
        });
        el.copyText.addEventListener('click', function () {
            if (!current) return;
            copyText(current.resultText).then(function () {
                showCopyHint('结果已复制');
            }, function () {
                showCopyHint('复制失败，请手动选择结果');
            });
        });

        computeNow();

        // 调试/自动化钩子（浏览器验收脚本使用；不影响正常交互）
        window.DetPage = {
            getState: function () { return { n: state.n, cells: cloneCells(state.cells) }; },
            getResult: function () { return current; },
            setMatrix: function (n, cells) {
                state.n = Math.max(MIN_SIZE, Math.min(MAX_SIZE, n));
                state.cells = resizeCells(cells || makeCells(state.n), state.n);
                renderGrid();
                computeNow();
            },
            setExample: applyExample,
            compute: computeNow
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
