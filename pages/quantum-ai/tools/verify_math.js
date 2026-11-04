// Offline KaTeX validation of every math expression in src/_math.json
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const katex = require(path.join(ROOT, 'assets', 'katex', 'katex.min.js'));

const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', '_math.json'), 'utf8'));
let ok = 0, fail = 0;
const seen = new Set();
const failures = [];
for (const item of data) {
  seen.add(item.tex);
  try {
    katex.renderToString(item.tex, { throwOnError: true, displayMode: !!item.display, strict: 'ignore' });
    ok++;
  } catch (e) {
    fail++;
    failures.push((item.display ? '$$' : '$') + item.tex + (item.display ? '$$' : '$') + '  ::  ' + e.message.split('\n')[0]);
  }
}
console.log('公式数: ' + data.length + ' / 成功: ' + ok + ' / 失败: ' + fail + ' / 去重后: ' + seen.size);
if (failures.length) {
  console.log('\n--- 失败清单 ---');
  failures.slice(0, 80).forEach((f, i) => console.log((i + 1) + '. ' + f));
  process.exitCode = 1;
}
