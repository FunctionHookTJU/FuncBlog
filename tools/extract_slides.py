#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""课件 PDF → 讲义撰写用的原始数据（全文文本 + 逐页 PNG）。

这是「课件 → 讲义」流程的第 0 步（见 tools/LECTURE_STYLE.md）。
产出物：
  <out>/full.txt        逐页文本，页间用 ===== PAGE N ===== 分隔
  <out>/imgs/pNNN.png   逐页位图（dpi 可调），用于看图核对公式/表格/框图
  <out>/outline.json    每页前几行与字符数，便于快速掌握课件结构

用法：
    python tools/extract_slides.py --pdf "G:/学习/大三上/量子信息与量子计算/2026 P1 导论&量子力学基础 4.pdf" \
                                   --out "C:/Users/me/AppData/Local/Temp/qjys/P1"
    python tools/extract_slides.py --pdf "..." --out "..." --no-images   # 只要文本

为什么必须生成图片：PPT 导出的 PDF 里公式（OMML）会被抽成散乱字符、顺序全乱，
表格常按「自下而上、从右到左」反向抽取。凡涉及公式/表格/框图的页面，
必须用图片核对后才能落笔。
"""
import argparse
import json
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # pragma: no cover
    pass

try:
    import pymupdf
except ImportError:  # pragma: no cover
    sys.exit("需要 pymupdf：<python> -m pip install pymupdf")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True, help="课件 PDF 路径")
    ap.add_argument("--out", required=True, help="输出目录")
    ap.add_argument("--dpi", type=int, default=105, help="逐页 PNG 的 dpi（默认 105）")
    ap.add_argument("--no-images", action="store_true", help="只出文本，不渲染 PNG")
    ap.add_argument("--overwrite", action="store_true", help="重渲染已存在的 PNG")
    args = ap.parse_args()

    if not os.path.exists(args.pdf):
        sys.exit("找不到 PDF：%s" % args.pdf)

    os.makedirs(args.out, exist_ok=True)
    doc = pymupdf.open(args.pdf)
    imgdir = os.path.join(args.out, "imgs")
    if not args.no_images:
        os.makedirs(imgdir, exist_ok=True)

    chunks, outline, rendered = [], [], 0
    for i, page in enumerate(doc):
        text = page.get_text()
        chunks.append("\n===== PAGE %d =====\n" % (i + 1) + text)
        head = [l.strip() for l in text.splitlines() if l.strip()]
        outline.append({"page": i + 1, "chars": len(text), "head": head[:3]})
        if not args.no_images:
            png = os.path.join(imgdir, "p%03d.png" % (i + 1))
            if args.overwrite or not os.path.exists(png):
                page.get_pixmap(dpi=args.dpi).save(png)
                rendered += 1

    with open(os.path.join(args.out, "full.txt"), "w", encoding="utf-8") as f:
        f.write("".join(chunks))
    with open(os.path.join(args.out, "outline.json"), "w", encoding="utf-8") as f:
        json.dump({"pdf": os.path.basename(args.pdf), "pages": len(doc), "outline": outline},
                  f, ensure_ascii=False, indent=1)

    print("页数=%d  文本=%s  新渲染 PNG=%d  输出目录=%s"
          % (len(doc), os.path.join(args.out, "full.txt"), rendered, args.out))


if __name__ == "__main__":
    main()
