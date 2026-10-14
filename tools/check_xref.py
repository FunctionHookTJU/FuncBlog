#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""讲义交叉引用检查（只读）：找出悬空的「第 X.Y 节 / 见 X.Y.Z」引用。

用法（仓库根目录）：
    python tools/check_xref.py [slug ...]

可解析的引用目标：
  * lectures.json 里某节的编号（如 2.5、3.5）
  * 某节 md 内的 ### / #### 编号标题（如 2.5.1、3.5.5）
无法解析的引用即为悬空引用，按文件与行号列出。
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # pragma: no cover
    pass

# 引用形式：
#   带前缀的两/三级编号：「第 2.5 节」「见 3.5.5」「参见 2.6」「§3.5」
#   无前缀的三级编号：「满足 3.5.2 的操作主义定义」（三级编号在本语料里必是小节号）
REF = re.compile(
    r"(?:(?:第|见|参见|详见|回到|§)\s*(\d+\.\d+(?:\.\d+)?)"
    r"|(?<![\d.])(\d+\.\d+\.\d+)(?![\d.]))"
)


def collect_targets(cfg, slug):
    """返回 (节编号集合, 小节编号集合)。"""
    lec = next(l for l in cfg["lectures"] if l["slug"] == slug)
    secs = set()
    for s in lec["sections"]:
        m = re.match(r"^(\d+\.\d+)\s", s["title"])
        if m:
            secs.add(m.group(1))
    subs = set()
    d = os.path.join(ROOT, "pages", slug, "src")
    for fn in os.listdir(d):
        t = open(os.path.join(d, fn), encoding="utf-8").read()
        for m in re.finditer(r"^#{3,4}\s+(\d+\.\d+\.\d+)", t, flags=re.M):
            subs.add(m.group(1))
    return secs, subs


def scan(cfg, slug):
    secs, subs = collect_targets(cfg, slug)
    known = secs | subs
    d = os.path.join(ROOT, "pages", slug, "src")
    problems = []
    total = 0
    for fn in sorted(os.listdir(d)):
        path = os.path.join(d, fn)
        for i, line in enumerate(open(path, encoding="utf-8"), 1):
            if re.match(r"^#{3,4}\s", line):
                continue          # 标题行是「定义」该编号，不是引用
            for m in REF.finditer(line):
                ref = m.group(1) or m.group(2)
                total += 1
                if ref not in known:
                    problems.append((fn, i, ref, line.strip()[:110]))
    return total, len(known), problems


def main():
    cfg = json.load(open(os.path.join(ROOT, "tools", "lectures.json"), encoding="utf-8"))
    argv = sys.argv[1:]
    bad = 0
    for lec in cfg["lectures"]:
        if argv and lec["slug"] not in argv:
            continue
        total, nknown, problems = scan(cfg, lec["slug"])
        print("=" * 70)
        print("讲义 %s：解析到 %d 个引用，已知编号 %d 个" % (lec["slug"], total, nknown))
        if problems:
            bad = 1
            print("  ✗ 悬空引用 %d 处：" % len(problems))
            for fn, i, ref, txt in problems:
                print("     %s:%d  引用 %s  →  %s" % (fn, i, ref, txt))
        else:
            print("  ✓ 所有交叉引用均可解析")
    sys.exit(bad)


if __name__ == "__main__":
    main()
