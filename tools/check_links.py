#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""全站链接检查（只读）：遍历所有 HTML，抽出 href/src，验证站内目标是否存在。

用法（仓库根目录执行）：
    python tools/check_links.py            # 只报告问题，有问题时退出码 1
    python tools/check_links.py --all      # 连"正常"的统计一起打印
    python tools/check_links.py --json out.json   # 额外落一份 JSON，便于重构前后 diff

检查范围：
  * 站内相对链接（href / src），解析到仓库根，确认目标文件真实存在
  * 大小写敏感校验：GitHub Pages 跑在 Linux 上，`Pages/Diary.html` 与 `pages/diary.html`
    在 Windows 本地能打开、上线就 404。这里按"实际文件名的精确大小写"比对。
  * 跳出仓库根的引用（`../../x` 越过根）单独列为一类

不检查：外链（http/https//）、mailto:/tel:/javascript:/data:、纯锚点、页内 #id 是否存在。
"""
import argparse
import json
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:  # pragma: no cover
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SKIP_DIRS = {".git", ".workbuddy", "node_modules", "dist", "build", ".idea", ".vscode"}

# components/ 下是 HTML 片段（被 fetch 拼进页面），不是独立页面：
# 里面的相对链接是相对"引用它的页面"算的，按片段自身目录解析必然全是假死链。
SKIP_DIR_FILES = ("components/",)

ATTR_RE = re.compile(r"""\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')""", re.I)
EXTERNAL_RE = re.compile(r"^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|//)", re.I)
SKIP_SCHEMES = ("mailto:", "tel:", "javascript:", "data:", "blob:")


def iter_html():
    """产出 (相对仓库根的 posix 路径, 绝对路径)。"""
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if not fn.lower().endswith((".html", ".htm")):
                continue
            abs_p = os.path.join(dirpath, fn)
            rel = os.path.relpath(abs_p, ROOT).replace(os.sep, "/")
            if rel.startswith(SKIP_DIR_FILES):
                continue
            yield rel, abs_p


def build_index():
    """建两张表：精确路径集合 + 小写路径 → 真实路径（用于大小写诊断）。"""
    exact = set()
    lower = {}
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            abs_p = os.path.join(dirpath, fn)
            rel = os.path.relpath(abs_p, ROOT).replace(os.sep, "/")
            exact.add(rel)
            lower.setdefault(rel.lower(), []).append(rel)
    return exact, lower


def candidates(target):
    """一个链接可能指向的若干真实路径候选（按优先级）。"""
    out = [target]
    if target.endswith("/"):
        out.insert(0, target + "index.html")
    else:
        out.append(target + ".html")
        out.append(target + "/index.html")
    return out


def resolve(page_rel, raw):
    """把页面里的原始链接解析成仓库根相对路径；返回 (target, error)。

    error 为 None 表示解析成功但仍需查存在性；非 None 表示该链接根本不该检查。
    """
    link = raw.strip()
    if not link or link.startswith("#"):
        return None, "skip"
    if link.startswith(SKIP_SCHEMES) or EXTERNAL_RE.match(link):
        return None, "skip"
    # 去掉 query / fragment
    link = link.split("#", 1)[0].split("?", 1)[0]
    if not link:
        return None, "skip"
    if link.startswith("/"):
        # 站根绝对路径：本仓库明确禁止（GitHub Pages 子路径部署会 404）
        return link.lstrip("/"), "abs"
    base = os.path.dirname(page_rel)
    joined = os.path.normpath(os.path.join(base, link)).replace(os.sep, "/")
    if joined == ".":
        return None, "skip"
    if joined.startswith("../") or joined == "..":
        return joined, "outside"
    return joined, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="打印全部统计而不只是问题")
    ap.add_argument("--json", metavar="PATH", help="把结果写成 JSON")
    args = ap.parse_args()

    exact, lower = build_index()
    missing = []
    case_only = []
    outside = []
    abspath_links = []
    stats = {"pages": 0, "links": 0, "internal": 0}

    for page_rel, abs_p in sorted(iter_html()):
        stats["pages"] += 1
        try:
            with open(abs_p, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except OSError as exc:
            print("读取失败 %s: %s" % (page_rel, exc))
            continue
        for m in ATTR_RE.finditer(text):
            raw = m.group(1) if m.group(1) is not None else m.group(2)
            target, err = resolve(page_rel, raw)
            stats["links"] += 1
            if err == "skip":
                continue
            if err == "abs":
                abspath_links.append((page_rel, raw))
                continue
            if err == "outside":
                outside.append((page_rel, raw, target))
                continue
            stats["internal"] += 1
            hit = None
            for cand in candidates(target):
                if cand in exact:
                    hit = cand
                    break
            if hit:
                continue
            # 精确查找失败，看看是不是只差大小写
            near = [c for cand in candidates(target) for c in lower.get(cand.lower(), [])]
            if near:
                case_only.append((page_rel, raw, near[0]))
            else:
                missing.append((page_rel, raw, target))

    def dump(title, rows, fmt):
        if not rows:
            return
        print("\n%s（%d）" % (title, len(rows)))
        for row in rows:
            print("  " + fmt(row))

    if args.all:
        print("扫描页面 %d 个，链接 %d 条（站内 %d 条）" % (stats["pages"], stats["links"], stats["internal"]))
    dump("死链：目标不存在", missing, lambda r: "%s  ->  %s" % (r[0], r[1]))
    dump("大小写不匹配（本地能开，线上会 404）", case_only, lambda r: "%s  ->  %s （实际是 %s）" % (r[0], r[1], r[2]))
    dump("跳出仓库根", outside, lambda r: "%s  ->  %s" % (r[0], r[1]))
    dump("站根绝对路径（GitHub Pages 子路径下会 404）", abspath_links, lambda r: "%s  ->  %s" % (r[0], r[1]))

    bad = len(missing) + len(case_only) + len(outside)
    print("\n合计问题 %d 条（死链 %d / 大小写 %d / 越界 %d / 绝对路径提示 %d）"
          % (bad + len(abspath_links), len(missing), len(case_only), len(outside), len(abspath_links)))

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump({
                "stats": stats,
                "missing": [list(r) for r in missing],
                "case_only": [list(r) for r in case_only],
                "outside": [list(r) for r in outside],
                "absolute": [list(r) for r in abspath_links],
            }, fh, ensure_ascii=False, indent=1)
        print("已写出 %s" % args.json)

    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
