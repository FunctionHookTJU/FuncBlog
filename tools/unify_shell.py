#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把既有静态页的 header / footer 刷成 site_shell 的统一版本。

背景：crypto 三套讲义（pages/crypto-*，153 页）没有 md 源、也不走 build_lecture.py，
是纯 HTML。它们的外壳是复制来的，改导航要手改 153 次。本工具让它们也能被
tools/site_shell.py 统一驱动。

用法（仓库根目录执行）：
    python tools/unify_shell.py            # 只检查，报告哪些页面的外壳与规范不一致
    python tools/unify_shell.py --write    # 就地改写（只替换外壳区域，其余字节不动）
    python tools/unify_shell.py --check pages/crypto-hash-rsa   # 限定目录/文件

保证：
  * 只替换「SVG 定义 + <header>…</header>」和「<footer class="site-footer">…</footer>」
    两块区域，页面其余内容逐字节保留。
  * 改写后可用 `python tools/build_lecture.py` 重建讲义页，若产生 diff 说明两边不一致。
  * 没有内联 header 的页面（走 scripts/header.js 的那 15 页）会被跳过并列入清单。
"""
import argparse
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:  # pragma: no cover
    pass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import site_shell as shell  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SKIP_DIRS = {".git", ".workbuddy", "node_modules", "dist", "build", ".idea", ".vscode"}
SKIP_DIR_FILES = ("components/", "tools/")

# SVG 定义是可选的（个别页面可能没有），header 必须存在
SHELL_RE = re.compile(
    r'(?:<svg width="0" height="0" style="position:absolute" aria-hidden="true">.*?</svg>\s*)?'
    r'<header>.*?</header>',
    re.S,
)
FOOTER_RE = re.compile(r'<footer class="site-footer">.*?</footer>', re.S)


def iter_pages(targets):
    if targets:
        for t in targets:
            p = os.path.abspath(t)
            if os.path.isdir(p):
                for dirpath, dirnames, filenames in os.walk(p):
                    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
                    for fn in filenames:
                        if fn.lower().endswith((".html", ".htm")):
                            yield os.path.join(dirpath, fn)
            elif os.path.isfile(p):
                yield p
            else:
                print("跳过不存在的路径：%s" % t)
        return
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if fn.lower().endswith((".html", ".htm")):
                yield os.path.join(dirpath, fn)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="就地改写；不加则为只读检查")
    ap.add_argument("targets", nargs="*", help="限定文件或目录（默认全站）")
    args = ap.parse_args()

    site = shell.load_site()
    drift = []
    skipped_no_header = []
    changed_files = 0
    changed_regions = 0

    for path in sorted(iter_pages(args.targets)):
        rel = os.path.relpath(path, ROOT).replace(os.sep, "/")
        if rel.startswith(SKIP_DIR_FILES):
            continue
        with open(path, encoding="utf-8", errors="surrogateescape") as fh:
            text = fh.read()
        if "<header>" not in text:
            if 'scripts/header.js' in text:
                skipped_no_header.append(rel)
            continue

        prefix = shell.rel_prefix(rel)
        active = shell.active_for(rel, site["nav"])
        want_shell = shell.render_shell(prefix, site["nav"], active_href=active)
        want_footer = shell.render_footer(prefix)

        new = SHELL_RE.sub(lambda m: want_shell, text, count=1)
        new = FOOTER_RE.sub(lambda m: want_footer, new, count=1)

        if new == text:
            continue
        changed_files += 1
        # 统计实际发生替换的区域数，便于确认"只动了外壳"
        n_shell = len(SHELL_RE.findall(text))
        n_foot = len(FOOTER_RE.findall(text))
        changed_regions += n_shell + n_foot
        drift.append(rel)

        if args.write:
            # 换行风格跟随原文件，避免整文件被 CRLF/LF 重写
            nl = "\r\n" if "\r\n" in text[:2000] else "\n"
            with open(path, "w", encoding="utf-8", newline=nl) as fh:
                fh.write(new)

    if not drift:
        print("外壳一致：所有含内联 header 的页面都与 site_shell 渲染结果一致。")
    else:
        print("%s %d 个页面的外壳不一致（共 %d 处区域）："
              % ("已改写" if args.write else "待改写", changed_files, changed_regions))
        for rel in drift:
            print("  " + rel)

    if skipped_no_header:
        print("\n跳过 %d 个页面：没有内联 header（走 scripts/header.js，需另行处理）" % len(skipped_no_header))
        for rel in skipped_no_header[:20]:
            print("  " + rel)
        if len(skipped_no_header) > 20:
            print("  …… 其余 %d 个" % (len(skipped_no_header) - 20))

    return 0


if __name__ == "__main__":
    sys.exit(main())
