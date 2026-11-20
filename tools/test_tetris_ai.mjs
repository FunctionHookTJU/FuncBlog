// 俄罗斯方块 AI 引擎单测：特征计算 / 旋转去重 / 消行 / 自对弈存活与性能
// 用法: node tools/test_tetris_ai.mjs（失败时 exit 1）
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const AI = require('../scripts/tetrisAI.js');

const SHAPES = {
  I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
  O: [[1,1],[1,1]],
  T: [[0,1,0],[1,1,1],[0,0,0]],
  S: [[0,1,1],[1,1,0],[0,0,0]],
  Z: [[1,1,0],[0,1,1],[0,0,0]],
  J: [[1,0,0],[1,1,1],[0,0,0]],
  L: [[0,0,1],[1,1,1],[0,0,0]]
};

function makeBag(rng) {
  const keys = Object.keys(SHAPES);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  return keys;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function playGame(weights, seed, maxPieces) {
  const rng = mulberry32(seed);
  let grid = AI.emptyGrid();
  let bag = [];
  let pieces = 0, lines = 0, cleared4 = 0;
  const history = [];
  while (pieces < maxPieces) {
    if (!bag.length) bag = makeBag(rng);
    const type = bag.shift();
    const matrix = SHAPES[type];
    const best = AI.bestPlacement(grid, matrix, { weights, lookahead: true, nextMatrix: bag.length ? SHAPES[bag[0]] : null });
    if (!best) break; // 无处可放 → 顶死
    grid = best.gridAfter;
    lines += best.cleared;
    if (best.cleared === 4) cleared4++;
    pieces++;
    history.push({ type, cleared: best.cleared, score: best.score });
  }
  return { pieces, lines, cleared4, died: pieces < maxPieces, grid, history };
}

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + ' :: ' + JSON.stringify(extra)); } }

// 1) 特征计算
{
  const g = AI.emptyGrid();
  ok('空盘洞数=0', AI.countHoles(g) === 0);
  ok('空盘井数=0', AI.countWells(g) === 0);
  ok('空盘行转换=40（含左右边界，每行 2 次）', AI.countRowTransitions(g) === 40, AI.countRowTransitions(g));
  ok('空盘列转换=10（每列天花板处 1 次；地板开放不计）', AI.countColumnTransitions(g) === 10, AI.countColumnTransitions(g));

  // 一个洞：(9,19) 与 (9,18) 填满、下方空
  const g2 = AI.emptyGrid();
  g2[19][9] = 1; g2[18][9] = 1;
  g2[19][8] = 1; g2[19][7] = 1;
  ok('有洞检测', AI.countHoles(g2) === 0, AI.countHoles(g2)); // 下方无空格
  const g3 = AI.emptyGrid();
  g3[19][9] = 1; g3[17][9] = 1;
  ok('洞=1', AI.countHoles(g3) === 1, AI.countHoles(g3));
}

// 2) rotationStates 去重
{
  ok('I 有 2 个旋转态', AI.rotationStates(SHAPES.I).length === 2, AI.rotationStates(SHAPES.I).length);
  ok('O 有 1 个旋转态', AI.rotationStates(SHAPES.O).length === 1);
  ok('T 有 4 个旋转态', AI.rotationStates(SHAPES.T).length === 4);
  ok('S 有 2 个旋转态', AI.rotationStates(SHAPES.S).length === 2);
}

// 3) 消行
{
  const g = AI.emptyGrid();
  for (let x = 0; x < 10; x++) g[19][x] = 1;
  const res = AI.clearFullRows(g);
  ok('消满行 1 行', res.rows.length === 1 && res.rows[0] === 19, res.rows);
  ok('消行后棋盘仍 20 行', res.grid.length === 20);
  ok('消行后全空', res.grid.every(r => r.every(c => !c)));
}

// 4) 简单局面：空盘放 O 块应贴底
{
  const best = AI.bestPlacement(AI.emptyGrid(), SHAPES.O);
  ok('O 最优摆放存在', !!best);
  ok('O 落到底部', best && best.y === 18, best && best.y);
}

// 5) 自对弈：El-Tetris 权重应能长时间生存
{
  const results = [];
  for (const seed of [1, 2, 3]) {
    const r = playGame(AI.WEIGHTS.eltetris, seed, 5000);
    results.push(r);
    console.log(`seed ${seed}: pieces=${r.pieces} lines=${r.lines} tetris=${r.cleared4} died=${r.died}`);
    ok(`seed ${seed} 存活 >=2000 块`, r.pieces >= 2000, r.pieces);
  }
  const totalLines = results.reduce((a, b) => a + b.lines, 0);
  ok('总消行 >= 500', totalLines >= 500, totalLines);
}

// 6) 性能
{
  const g = AI.emptyGrid();
  for (let y = 12; y < 20; y++) for (let x = 0; x < 10; x++) if ((x * 7 + y * 3) % 4 !== 0) g[y][x] = 1;
  const t0 = Date.now();
  for (let i = 0; i < 500; i++) {
    AI.bestPlacement(g, SHAPES.T, { lookahead: true, nextMatrix: SHAPES.I });
  }
  const dt = Date.now() - t0;
  ok('500 次 2-ply 决策 < 5s', dt < 5000, dt);
  console.log('perf: 500 decisions ms =', dt);
}

console.log(`\nRESULT: ${fail ? 'FAIL' : 'PASS'} (${pass} pass / ${fail} fail)`);
process.exit(fail ? 1 : 0);
