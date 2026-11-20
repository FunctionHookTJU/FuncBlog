// 三套权重自对弈对比（El-Tetris / Dellacherie / Lee），每套跑 3 个固定随机种子
// 用法: node tools/bench_tetris_ai.mjs
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
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function playGame(weights, seed, maxPieces) {
  const rng = mulberry32(seed);
  let grid = AI.emptyGrid(); let bag = []; let pieces = 0, lines = 0;
  while (pieces < maxPieces) {
    if (!bag.length) {
      const keys = Object.keys(SHAPES);
      for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
      bag = keys;
    }
    const type = bag.shift();
    const best = AI.bestPlacement(grid, SHAPES[type], { weights, lookahead: true, nextMatrix: bag.length ? SHAPES[bag[0]] : null });
    if (!best) break;
    grid = best.gridAfter; lines += best.cleared; pieces++;
  }
  return { pieces, lines };
}
for (const [name, w] of [['eltetris', AI.WEIGHTS.eltetris], ['dellacherie', AI.WEIGHTS.dellacherie], ['lee', AI.WEIGHTS.lee]]) {
  const rs = [1, 2, 3].map(seed => playGame(w, seed, 3000));
  const avgLines = Math.round(rs.reduce((a, r) => a + r.lines, 0) / rs.length);
  const avgPieces = Math.round(rs.reduce((a, r) => a + r.pieces, 0) / rs.length);
  console.log(`${name}: pieces=${rs.map(r=>r.pieces).join('/')} lines=${rs.map(r=>r.lines).join('/')} avgLines=${avgLines} avgPieces=${avgPieces}`);
}
