/**
 * 俄罗斯方块 AI 引擎（纯 ES5 风格、零依赖、可在浏览器与 Node 中运行）
 *
 * 思路：1-ply 全摆放搜索 + 启发式打分。
 *   - 枚举当前方块的所有「旋转 × 落点」组合（最多 4×10 ≈ 40 个）；
 *   - 模拟落下、锁定、消行，得到候选局面；
 *   - 用 Dellacherie 的 6 个特征（落地高度 / 消除的方块格 / 行转换 / 列转换 / 洞 / 井）
 *     乘以经验权重打分，取得分最高者。
 *
 * 实现依据（详见 docs/tetris-ai.html 的参考文献）：
 *   - Pierre Dellacherie 的评测函数与 6 个特征（2003 年左右公开，未公开官方权重）；
 *   - El-Tetris 用交叉熵/遗传算法调出的权重（本文件 WEIGHTS.eltetris）；
 *   - Yiyuan Lee 的 4 特征简化版（WEIGHTS.lee）。
 *
 * 用法：
 *   浏览器：<script src="tetrisAI.js"></script> 后使用 window.TetrisAI
 *   Node：  const TetrisAI = require('./scripts/tetrisAI.js')
 *
 * 主要 API：
 *   TetrisAI.bestPlacement(grid, matrix, options?)  返回最佳摆放 {rot, x, y, matrix, score, features, cleared}
 *   TetrisAI.enumeratePlacements(grid, matrix)      返回全部合法摆放
 *   TetrisAI.simulateDrop(grid, matrix, x, rot)     只模拟，返回 {y, valid}
 *   TetrisAI.evaluate(grid)                         计算局面特征
 *   TetrisAI.clearFullRows(grid)                    消行，返回 {grid, rows}
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.TetrisAI = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var ROWS = 20;
    var COLS = 10;

    /* ============================================================
     * 一、权重方案
     * ============================================================ */

    // El-Tetris（Islam El-Ashi, 2011，PSO 调参）公开权重。
    // 注意：El-Tetris 把 Dellacherie 的「eroded piece cells」换成了「消行数(Rows eliminated)」，
    // 两者不可混用，这里按 El-Tetris 原文配套使用 completeLines。
    var W_ELTETRIS = {
        landingHeight: -4.500158825082766,
        completeLines: 3.4181268101392694,
        rowTransitions: -3.2178882868487753,
        columnTransitions: -9.348695305445199,
        holes: -7.899265427351652,
        wells: -3.3855972247263626
    };

    // Pierre Dellacherie（2003，手工试错）的原始六特征权重（二手转述：Fahey 2003 → Thiery & Scherrer 2009）。
    // 与 El-Tetris 的差别是正向特征用 erodedPieceCells。
    var W_DELLACHERIE = {
        landingHeight: -1,
        erodedPieceCells: 1,
        rowTransitions: -1,
        columnTransitions: -1,
        holes: -4,
        wells: -1
    };

    // Yiyuan Lee（2013，遗传算法调参）的 4 特征权重（符号：负正负负）
    var W_LEE = {
        aggregateHeight: -0.510066,
        completeLines: 0.760666,
        holes: -0.35663,
        bumpiness: -0.184483
    };

    /* ============================================================
     * 二、棋盘工具（只关心「有/无」，不关心方块颜色）
     * ============================================================ */

    function emptyGrid() {
        var g = [];
        for (var y = 0; y < ROWS; y++) {
            var row = [];
            for (var x = 0; x < COLS; x++) row.push(null);
            g.push(row);
        }
        return g;
    }

    function cloneGrid(grid) {
        var out = [];
        for (var y = 0; y < grid.length; y++) out.push(grid[y].slice());
        return out;
    }

    function isFilled(grid, x, y) {
        if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
        return !!grid[y][x];
    }

    function rotateMatrix(m) {
        var n = m.length;
        var out = [];
        for (var y = 0; y < n; y++) {
            var row = [];
            for (var x = 0; x < n; x++) row.push(0);
            out.push(row);
        }
        for (var yy = 0; yy < n; yy++) {
            for (var xx = 0; xx < n; xx++) out[xx][n - 1 - yy] = m[yy][xx];
        }
        return out;
    }

    /** 去掉空行空列，得到紧凑方块（便于判断重复旋转）。 */
    function normalize(m) {
        var minY = m.length, maxY = -1, minX = m[0].length, maxX = -1;
        for (var y = 0; y < m.length; y++) {
            for (var x = 0; x < m[y].length; x++) {
                if (!m[y][x]) continue;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
            }
        }
        if (maxY < 0) return [];
        var out = [];
        for (var yy = minY; yy <= maxY; yy++) {
            var row = [];
            for (var xx = minX; xx <= maxX; xx++) row.push(m[yy][xx] ? 1 : 0);
            out.push(row);
        }
        return out;
    }

    function matrixKey(m) {
        var rows = [];
        for (var y = 0; y < m.length; y++) rows.push(m[y].join(''));
        return rows.join('|');
    }

    /** 形状指纹：把任意朝向的方块规范化成紧凑形状后的字符串，便于比较「是不是同一个朝向」。 */
    function shapeKey(matrix) {
        return matrixKey(normalize(toSquare(matrix)));
    }

    /** 把方块补成正方形（旋转必须对正方形做，否则会扭曲形状）。 */
    function toSquare(m) {
        var h = m.length;
        var w = m[0].length;
        var n = Math.max(h, w);
        var out = [];
        for (var y = 0; y < n; y++) {
            var row = [];
            for (var x = 0; x < n; x++) {
                row.push(y < h && x < w && m[y][x] ? 1 : 0);
            }
            out.push(row);
        }
        return out;
    }

    /** 当前的各旋转形态（已去重、并各自紧凑化）。 */
    function rotationStates(matrix) {
        var states = [];
        var seen = {};
        var cur = normalize(toSquare(matrix));
        for (var i = 0; i < 4; i++) {
            var key = matrixKey(cur);
            if (!seen[key]) {
                seen[key] = true;
                states.push(cur);
            }
            cur = normalize(rotateMatrix(toSquare(cur)));
        }
        return states;
    }

    /* ============================================================
     * 三、掉落模拟与消行
     * ============================================================ */

    /**
     * 从棋盘上方把方块垂直放下。
     * 返回 {y, valid}：valid=false 表示该列放不下（左右越界，或落下后仍有格子悬在棋盘上方）。
     */
    function simulateDrop(grid, matrix, x) {
        var h = matrix.length;
        // 从方块完全位于棋盘上方的位置开始下落
        var y = -h;
        // 先确保初始位置不撞（宽度越界直接失败）
        for (var cy = 0; cy < h; cy++) {
            for (var cx = 0; cx < matrix[cy].length; cx++) {
                if (!matrix[cy][cx]) continue;
                var px = x + cx;
                if (px < 0 || px >= COLS) return { y: y, valid: false };
            }
        }
        // 一直往下掉，直到再下一格会撞
        while (!collides(grid, matrix, x, y + 1)) y++;
        if (collides(grid, matrix, x, y)) return { y: y, valid: false };
        // 不允许悬空在棋盘上方（等于堆到顶了）
        for (var ry = 0; ry < h; ry++) {
            for (var rx = 0; rx < matrix[ry].length; rx++) {
                if (!matrix[ry][rx]) continue;
                if (y + ry < 0) return { y: y, valid: false };
            }
        }
        return { y: y, valid: true };
    }

    function collides(grid, matrix, x, y) {
        for (var cy = 0; cy < matrix.length; cy++) {
            for (var cx = 0; cx < matrix[cy].length; cx++) {
                if (!matrix[cy][cx]) continue;
                var nx = x + cx;
                var ny = y + cy;
                if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
                if (ny >= 0 && grid[ny][nx]) return true;
            }
        }
        return false;
    }

    /** 把方块锁进棋盘（返回新棋盘，不修改原棋盘）。 */
    function lockPiece(grid, matrix, x, y, marker) {
        var g = cloneGrid(grid);
        for (var cy = 0; cy < matrix.length; cy++) {
            for (var cx = 0; cx < matrix[cy].length; cx++) {
                if (!matrix[cy][cx]) continue;
                var ny = y + cy;
                var nx = x + cx;
                if (ny >= 0 && ny < ROWS && nx >= 0 && nx < COLS) g[ny][nx] = marker || 1;
            }
        }
        return g;
    }

    /** 消除满行；返回 {grid, rows}。 */
    function clearFullRows(grid) {
        var rows = [];
        var kept = [];
        for (var y = 0; y < grid.length; y++) {
            var full = true;
            for (var x = 0; x < COLS; x++) {
                if (!grid[y][x]) { full = false; break; }
            }
            if (full) rows.push(y);
            else kept.push(grid[y]);
        }
        while (kept.length < ROWS) {
            var empty = [];
            for (var i = 0; i < COLS; i++) empty.push(null);
            kept.unshift(empty);
        }
        return { grid: kept, rows: rows };
    }

    /* ============================================================
     * 四、特征（Dellacherie 6 项）
     * ============================================================ */

    function columnHeights(grid) {
        var heights = [];
        for (var x = 0; x < COLS; x++) {
            var h = 0;
            for (var y = 0; y < ROWS; y++) {
                if (grid[y][x]) { h = ROWS - y; break; }
            }
            heights.push(h);
        }
        return heights;
    }

    /** 洞：某列中，上方已有方块、自身为空的格子总数。 */
    function countHoles(grid) {
        var holes = 0;
        for (var x = 0; x < COLS; x++) {
            var seenBlock = false;
            for (var y = 0; y < ROWS; y++) {
                if (grid[y][x]) seenBlock = true;
                else if (seenBlock) holes++;
            }
        }
        return holes;
    }

    /** 行转换：每行相邻格（含左右边界）填充状态变化次数。 */
    function countRowTransitions(grid) {
        var t = 0;
        for (var y = 0; y < ROWS; y++) {
            var prev = true; // 左墙视为已填充
            for (var x = 0; x < COLS; x++) {
                var cur = !!grid[y][x];
                if (cur !== prev) t++;
                prev = cur;
            }
            if (prev !== true) t++; // 右墙
        }
        return t;
    }

    /**
     * 列转换：每列相邻格填充状态变化次数。
     * 边界口径同 El-Tetris：天花板（上方）视为填充，地板以下开放、不计额外变换。
     */
    function countColumnTransitions(grid) {
        var t = 0;
        for (var x = 0; x < COLS; x++) {
            var prev = true; // 天花板上方视为填充
            for (var y = 0; y < ROWS; y++) {
                var cur = !!grid[y][x];
                if (cur !== prev) t++;
                prev = cur;
            }
            // 地板以下不封闭，不计额外变换
        }
        return t;
    }

    /** 累积井：连续井格按 1+2+3… 累加；最左/最右列把板外当墙（只需内侧一格填充）。 */
    function countWells(grid) {
        var total = 0;
        for (var x = 0; x < COLS; x++) {
            var depth = 0;
            for (var y = 0; y < ROWS; y++) {
                var filled = !!grid[y][x];
                var leftFilled = x === 0 ? true : !!grid[y][x - 1];
                var rightFilled = x === COLS - 1 ? true : !!grid[y][x + 1];
                if (!filled && leftFilled && rightFilled) {
                    depth++;
                    total += depth;
                } else {
                    depth = 0;
                }
            }
        }
        return total;
    }

    /** 落地高度：方块最低格所在行距底部的距离；El-Tetris 口径再加上「方块高/2」。 */
    function landingHeightOf(matrix, bottomRow) {
        var h = matrix.length;
        var bottomMost = -1;
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < matrix[y].length; x++) {
                if (matrix[y][x]) { bottomMost = Math.max(bottomMost, y); }
            }
        }
        var pieceHeight = bottomMost + 1;
        return (ROWS - bottomRow) + pieceHeight / 2;
    }

    function aggregateHeight(grid) {
        var hs = columnHeights(grid);
        var s = 0;
        for (var i = 0; i < hs.length; i++) s += hs[i];
        return s;
    }

    function bumpiness(grid) {
        var hs = columnHeights(grid);
        var s = 0;
        for (var i = 0; i < hs.length - 1; i++) s += Math.abs(hs[i] - hs[i + 1]);
        return s;
    }

    /** 完整局面特征（对 Dellacherie / Lee 两套权重都够用）。 */
    function evaluate(grid) {
        return {
            landingHeight: 0,
            erodedPieceCells: 0,
            rowTransitions: countRowTransitions(grid),
            columnTransitions: countColumnTransitions(grid),
            holes: countHoles(grid),
            wells: countWells(grid),
            aggregateHeight: aggregateHeight(grid),
            completeLines: 0,
            bumpiness: bumpiness(grid)
        };
    }

    /**
     * 权重打分。
     * 支持三套特征：El-Tetris（6 项，含 completeLines）、Dellacherie（6 项，含 erodedPieceCells）、
     * Lee（4 项）。由权重对象里出现哪些键决定，不要混用。
     */
    function scoreFeatures(f, w) {
        if (w.aggregateHeight !== undefined) {
            // Lee 的 4 特征方案
            return (w.aggregateHeight * (f.aggregateHeight || 0))
                + (w.completeLines * (f.completeLines || 0))
                + (w.holes * (f.holes || 0))
                + (w.bumpiness * (f.bumpiness || 0));
        }
        return (w.landingHeight * f.landingHeight)
            + ((w.completeLines !== undefined ? w.completeLines * f.completeLines : 0))
            + ((w.erodedPieceCells !== undefined ? w.erodedPieceCells * f.erodedPieceCells : 0))
            + (w.rowTransitions * f.rowTransitions)
            + (w.columnTransitions * f.columnTransitions)
            + (w.holes * f.holes)
            + (w.wells * f.wells);
    }

    /* ============================================================
     * 五、搜索
     * ============================================================ */

    /**
     * 枚举当前方块在给定棋盘上的所有合法摆放。
     * matrix 需为紧凑方块（normalize 过）。
     */
    function enumeratePlacements(grid, matrix) {
        var states = rotationStates(matrix);
        var out = [];
        for (var s = 0; s < states.length; s++) {
            var m = states[s];
            var w = m[0].length;
            for (var x = -w + 1; x < COLS; x++) {
                var drop = simulateDrop(grid, m, x);
                if (!drop.valid) continue;
                var locked = lockPiece(grid, m, x, drop.y, 1);
                var clearedRes = clearFullRows(locked);
                var cleared = clearedRes.rows.length;

                // 落地高度（El-Tetris 口径：列落点高度 + 方块高/2）
                var bottom = drop.y;
                for (var yy = 0; yy < m.length; yy++) {
                    for (var xx = 0; xx < m[yy].length; xx++) {
                        if (m[yy][xx]) bottom = Math.max(bottom, drop.y + yy);
                    }
                }
                var landingHeight = landingHeightOf(m, bottom);

                // 被消除的方块格数：本方块落在被消行里的格子数
                var erodedCells = 0;
                for (var r = 0; r < clearedRes.rows.length; r++) {
                    var rowIndex = clearedRes.rows[r];
                    for (var cx2 = 0; cx2 < m[0].length; cx2++) {
                        var px = x + cx2;
                        if (px < 0 || px >= COLS) continue;
                        if (pieceOccupies(m, x, drop.y, px, rowIndex)) erodedCells++;
                    }
                }
                var erodedPieceCells = erodedCells * cleared;

                var feats = evaluate(clearedRes.grid);
                feats.landingHeight = landingHeight;
                feats.erodedPieceCells = erodedPieceCells;
                feats.completeLines = cleared;

                out.push({
                    rot: s,
                    x: x,
                    y: drop.y,
                    matrix: m,
                    cleared: cleared,
                    features: feats,
                    gridAfter: clearedRes.grid
                });
            }
        }
        return out;
    }

    function pieceOccupies(m, px0, py0, px, py) {
        for (var y = 0; y < m.length; y++) {
            for (var x = 0; x < m[y].length; x++) {
                if (!m[y][x]) continue;
                if (px0 + x === px && py0 + y === py) return true;
            }
        }
        return false;
    }

    /**
     * 选出最佳摆放。
     * options.weights  —— 权重对象，默认 WEIGHTS.eltetris
     * options.lookahead —— 是否用「下一个方块」做 2-ply 评估（默认 false）
     * options.nextMatrix —— lookahead 时用到的下一块（紧凑矩阵）
     */
    function bestPlacement(grid, matrix, options) {
        options = options || {};
        var weights = options.weights || W_ELTETRIS;
        var compact = normalize(matrix);
        if (!compact.length) return null;

        var candidates = enumeratePlacements(grid, compact);
        if (!candidates.length) return null;

        var best = null;
        var bestScore = -Infinity;
        var useLookahead = !!options.lookahead && !!options.nextMatrix && normalize(options.nextMatrix).length > 0;
        var nextStates = useLookahead ? rotationStates(normalize(options.nextMatrix)) : null;

        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];
            var score = scoreFeatures(c.features, weights);
            if (useLookahead) {
                // 2-ply：假设下一个方块也按最优摆放，取子局面得分作为修正
                var sub = nextBestScore(c.gridAfter, nextStates, weights);
                score += sub * 0.5;
            }
            c.score = score;
            if (score > bestScore) {
                bestScore = score;
                best = c;
            }
        }
        return best;
    }

    function nextBestScore(grid, states, weights) {
        var bestScore = -Infinity;
        for (var s = 0; s < states.length; s++) {
            var m = states[s];
            var w = m[0].length;
            for (var x = -w + 1; x < COLS; x++) {
                var drop = simulateDrop(grid, m, x);
                if (!drop.valid) continue;
                var locked = lockPiece(grid, m, x, drop.y, 1);
                var res = clearFullRows(locked);
                var feats = evaluate(res.grid);
                feats.completeLines = res.rows.length;
                var bottom = drop.y;
                for (var yy = 0; yy < m.length; yy++) {
                    for (var xx = 0; xx < m[yy].length; xx++) {
                        if (m[yy][xx]) bottom = Math.max(bottom, drop.y + yy);
                    }
                }
                feats.landingHeight = landingHeightOf(m, bottom);
                var sc = scoreFeatures(feats, weights);
                if (sc > bestScore) bestScore = sc;
            }
        }
        return bestScore === -Infinity ? 0 : bestScore;
    }

    /* ============================================================
     * 六、导出
     * ============================================================ */

    return {
        version: '1.0.0',
        ROWS: ROWS,
        COLS: COLS,
        WEIGHTS: { eltetris: W_ELTETRIS, dellacherie: W_DELLACHERIE, lee: W_LEE },
        emptyGrid: emptyGrid,
        cloneGrid: cloneGrid,
        normalize: normalize,
        shapeKey: shapeKey,
        rotateMatrix: rotateMatrix,
        rotationStates: rotationStates,
        simulateDrop: simulateDrop,
        collides: collides,
        lockPiece: lockPiece,
        clearFullRows: clearFullRows,
        evaluate: evaluate,
        scoreFeatures: scoreFeatures,
        enumeratePlacements: enumeratePlacements,
        bestPlacement: bestPlacement,
        countHoles: countHoles,
        countWells: countWells,
        countRowTransitions: countRowTransitions,
        countColumnTransitions: countColumnTransitions
    };
});
