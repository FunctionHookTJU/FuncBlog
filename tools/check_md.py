#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""讲义 Markdown 源文件自检（只读，不写任何文件）。

供撰写者自查用。用法（仓库根目录）：
    python tools/check_md.py pages/quantum-foundations/src/qf-01.md [...]
    python tools/check_md.py --all quantum-foundations

检查项：
  1. 标题层级：只允许 ### / ####，不允许 # 和 ##（页面标题由 json 提供）
  2. 数学定界符成对（$ / $$）
  3. 禁止硬写 Unicode 上下标（²³ⁿ⁺⁻₀₁₂ᵢ 等）——必须用真 LaTeX
  4. 禁止残留的 Markdown 语法碎片、TODO/待补 之类占位
  5. 正文长度（中文讲义建议 3800–12000 字符）
  6. 【补】/【勘误】标记使用正确
  7. 表格：标准 md 表格必须带分隔行；裸表用 HTML，且 HTML 标签成对
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

try:  # 保证中文输出在 Windows 控制台不乱码
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:  # pragma: no cover
    pass

SUP_SUB = re.compile(r"[\u00B2\u00B3\u00B9\u2070-\u209F\u1D2C-\u1D6A\u02B0-\u02B7]")
TODO = re.compile(r"(TODO|TBD|待补|待写|待填|XXX|\?\?\?)")
LANGLE = re.compile(r"\\[\(\[]|\\[\)\]]")


def check(path):
    errs, warns = [], []
    text = open(path, encoding="utf-8").read()
    name = os.path.relpath(path, ROOT)
    is_index = os.path.basename(path) == "index.md"

    # 1. 标题层级
    for m in re.finditer(r"^(#{1,6})\s+(.*)$", text, flags=re.M):
        lvl = len(m.group(1))
        if lvl <= 2:
            errs.append("第 %d 行：出现 %s 级标题，正文只能用 ### / ####（页面标题由 lectures.json 提供）"
                        % (text[:m.start()].count("\n") + 1, lvl))
    if not re.search(r"^###\s", text, flags=re.M):
        warns.append("没有任何 ### 小节标题，结构可能过平")

    # 2. 数学定界符
    body = re.sub(r"`[^`]*`", "", text)            # 去掉行内代码
    body = re.sub(r"```.*?```", "", body, flags=re.S)
    disp = len(re.findall(r"\$\$", body))
    if disp % 2:
        errs.append("$$ 出现 %d 次（奇数），有未闭合的独立公式" % disp)
    inline_text = re.sub(r"\$\$.+?\$\$", "", body, flags=re.S)
    single = len(re.findall(r"(?<!\$)\$(?!\$)", inline_text))
    if single % 2:
        errs.append("$ 出现 %d 次（奇数），有未闭合的行内公式" % single)
    if re.search(r"(?<!\\)\\[\(\[]|(?<!\\)\\[\)\]]", body):
        errs.append("出现 LaTeX 定界符 \\( \\) / \\[ \\]，请改用 $...$ / $$...$$（注意 \\\\[2pt] 这类行距修饰不算，但会误伤时请改写成 \\\\[2pt] 之外的形式）")

    # 3. Unicode 上下标
    hits = SUP_SUB.findall(body)
    if hits:
        errs.append("硬写 Unicode 上下标 %d 处（如 %s），必须写成真 LaTeX"
                    % (len(hits), " ".join(sorted(set(hits))[:8])))

    # 4. 占位残留（ASCII 结构图里的 ? 不算）
    for m in TODO.finditer(body):
        errs.append("疑似占位残留：%s（第 %d 行）" % (m.group(0), body[:m.start()].count("\n") + 1))

    # 5. 长度
    n = len(re.sub(r"\s", "", text))
    if n < 3800 and not is_index:
        warns.append("正文仅 %d 字符（不含空白），低于建议下限 3800" % n)
    if n > 14000:
        warns.append("正文 %d 字符，偏长（建议拆到相邻小节）" % n)

    # 6. 标记
    if "**补**" in text or "**勘误**" in text:
        errs.append("补丁标记请直接写 【补】/【勘误】，不要用 **加粗** 包裹")

    # 7. 表格
    lines = text.split("\n")
    for i, ln in enumerate(lines):
        if ln.strip().startswith("|") and ln.strip().endswith("|"):
            prev = lines[i - 1].strip() if i else ""
            nxt = lines[i + 1].strip() if i + 1 < len(lines) else ""
            is_sep = bool(re.match(r"^\|[\s:\-|]+\|$", ln.strip()))
            prev_is_row = prev.startswith("|") and prev.endswith("|")
            nxt_is_sep = bool(re.match(r"^\|[\s:\-|]+\|$", nxt))
            if not is_sep and not prev_is_row and not nxt_is_sep:
                warns.append("第 %d 行：疑似表格但缺少分隔行 |---|---|" % (i + 1))
    for tag in ("table", "div", "tr", "td", "th"):
        o = len(re.findall(r"<%s[\s>]" % tag, text))
        c = len(re.findall(r"</%s>" % tag, text))
        if o != c:
            errs.append("HTML 标签 <%s> 开 %d 闭 %d，不成对" % (tag, o, c))

    return name, errs, warns


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    if args[0] == "--all":
        slug = args[1]
        d = os.path.join(ROOT, "pages", slug, "src")
        files = sorted(os.path.join(d, f) for f in os.listdir(d) if f.endswith(".md"))
    else:
        files = args

    bad = 0
    for f in files:
        if not os.path.exists(f):
            print("缺失: %s" % f)
            bad = 1
            continue
        name, errs, warns = check(f)
        if errs:
            bad = 1
            print("[错误] %s" % name)
            for e in errs:
                print("   ✗ %s" % e)
        else:
            print("[OK]   %s" % name)
        for w in warns:
            print("   ! %s" % w)
    sys.exit(bad)


if __name__ == "__main__":
    main()
