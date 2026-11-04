# -*- coding: utf-8 -*-
"""Build the handout (Markdown + offline-KaTeX HTML) from the per-chapter sources.

用法（在工作目录 quantum-ai-handout 下）：
    python tools/build.py          # 生成 index.html 与 quantum-ai-p3.md
    node tools/verify_math.js      # 离线校验全部公式能否被 KaTeX 渲染
"""
import re, os, sys, json, unicodedata, html as htmlmod
from urllib.parse import quote
import markdown

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src')
OUT_HTML = os.path.join(ROOT, 'index.html')
OUT_MD = os.path.join(ROOT, 'quantum-ai-p3.md')
TEMPLATE = os.path.join(ROOT, 'tools', 'template.html')

ORDER = [
    'p00_front.md',
    'GROUP:# 第一篇 地基：从经典 AI 的困境出发',
    'pA.md',
    'pB.md',
    'GROUP:# 第二篇 量子视角：从\u201c神秘\u201d到形式化',
    'pC.md',
    'GROUP:# 第三篇 方法与落地',
    'pD.md',
    'GROUP:# 附录',
    'glossaryA.md',
    'p90_appB.md',
    'faqD.md',
    'ansAll.md',
]

MATH_PH = '@@MATH%d@@'


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read().rstrip() + '\n'


def assemble_answers():
    """Rebuild 附录 D from the four per-writer answer files."""
    labels = [('ansA.md', '第 0 章 前置知识补课'),
              ('ansB.md', '第 1–2 章 什么是量子人工智能 / 三大范式的局限'),
              ('ansC.md', '第 3–4 章 量子力学与认知 / 量子认知表示系统与非经典概率'),
              ('ansD.md', '第 5–7 章 量子因果发现 / 高阶语义 / 回顾与结语')]
    chunks = ['## 附录 D 自测题参考答案\n',
              '答案按章排列，先自己写一遍再对照。凡是只给"结论"而没给推理的答案，'
              '都请回去看对应章节的推导——本讲义里没有需要背诵的公式，只有需要复现的推理。\n']
    for idx, (name, label) in enumerate(labels, 1):
        p = os.path.join(SRC, name)
        if not os.path.exists(p):
            print('  WARN missing answer file:', name)
            continue
        body = read(p).strip()
        body = re.sub(r'^(#{1,4}\s[^\n]*\n)+', '', body)
        body = re.sub(r'^Q\s+([\d.]+)', r'**Q \1**', body, flags=re.M)
        body = re.sub(r'(?<!\n)\n(A：)', r'\n\n\1', body)
        body = re.sub(r'^A：', r'**A**：', body, flags=re.M)
        chunks.append('\n### D.%d %s\n\n%s\n' % (idx, label, body))
    with open(os.path.join(SRC, 'ansAll.md'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(chunks))


def assemble():
    chunks, missing = [], []
    for item in ORDER:
        if item.startswith('GROUP:'):
            chunks.append('\n\n' + item[6:].strip() + '\n')
            continue
        p = os.path.join(SRC, item)
        if not os.path.exists(p):
            missing.append(item)
            continue
        chunks.append('\n\n' + read(p))
    return '\n'.join(chunks), missing


def protect_math(text):
    """Replace math outside code with placeholders; return (text, store)."""
    store, out, i, n = [], [], 0, len(text)
    while i < n:
        if text.startswith('```', i):
            j = text.find('```', i + 3)
            if j == -1:
                out.append(text[i:]); break
            out.append(text[i:j + 3]); i = j + 3; continue
        c = text[i]
        if c == '`':
            j = text.find('`', i + 1)
            if j != -1 and '\n' not in text[i:j]:
                out.append(text[i:j + 1]); i = j + 1; continue
        if text.startswith('$$', i):
            j = text.find('$$', i + 2)
            if j != -1:
                store.append((True, text[i + 2:j].strip()))
                out.append('\n\n' + MATH_PH % (len(store) - 1) + '\n\n')
                i = j + 2; continue
        if c == '$':
            j, found = i + 1, -1
            while j < n:
                if text[j] == '\\':
                    j += 2; continue
                if text[j] == '$':
                    found = j; break
                if text[j] == '\n':
                    break
                j += 1
            if found != -1 and found > i + 1:
                store.append((False, text[i + 1:found]))
                out.append(MATH_PH % (len(store) - 1))
                i = found + 1; continue
        out.append(c); i += 1
    return ''.join(out), store


def restore_math(html, store):
    for idx, (display, tex) in enumerate(store):
        rep = ('<div class="jysmath jysmath-display">\\[%s\\]</div>' % tex) if display \
            else ('<span class="jysmath">\\(%s\\)</span>' % tex)
        html = html.replace(MATH_PH % idx, rep)
    return html


def fix_empty_header_tables(md_text):
    """python-markdown's tables ext cannot handle an all-empty header row; emit raw HTML."""
    lines, out, i = md_text.split('\n'), [], 0
    while i < len(lines):
        line = lines[i]
        if line.strip().startswith('|') and i + 1 < len(lines) and \
                re.match(r'^\s*\|[\s:\-\|]+\|\s*$', lines[i + 1]):
            header = [c.strip() for c in line.strip().strip('|').split('|')]
            if all(c == '' for c in header):
                j, rows = i + 2, []
                while j < len(lines) and lines[j].strip().startswith('|'):
                    rows.append(lines[j]); j += 1
                out.append('<table class="grid">')
                for r in rows:
                    cells = [c.strip() for c in r.strip().strip('|').split('|')]
                    out.append('<tr>' + ''.join('<td>%s</td>' % c for c in cells) + '</tr>')
                out.append('</table>')
                i = j; continue
        out.append(line); i += 1
    return '\n'.join(out)


def slugify(value, separator='-'):
    """Keep CJK characters so anchors stay readable (default slugify strips them)."""
    value = unicodedata.normalize('NFKC', str(value)).strip().lower()
    value = re.sub(r'[^\w\u4e00-\u9fff\-\s]', '', value)
    value = re.sub(r'[\s]+', separator, value)
    value = re.sub(r'-{2,}', separator, value).strip(separator)
    return value or 'sec'


def strip_tags(s):
    return re.sub(r'<[^>]+>', '', s)


def build_nav(body):
    entries = [(m.group(1), m.group(2), strip_tags(m.group(3)).strip())
               for m in re.finditer(r'<(h1|h2)[^>]*id="([^"]+)"[^>]*>(.*?)</\1>', body, flags=re.S)]
    parts = ['<nav id="nav" aria-label="目录">',
             '<div class="navhead"><span>目录</span><button id="navclose" title="收起目录">✕</button></div>',
             '<div class="navbody">']
    in_group = False
    for lvl, hid, txt in entries:
        if lvl == 'h1':
            if in_group:
                parts.append('</div>')
            parts.append('<div class="navgrp">')
            parts.append('<div class="navlab">%s</div>' % htmlmod.escape(txt))
            in_group = True
        else:
            parts.append('<a href="#%s" data-target="%s">%s</a>'
                         % (quote(hid), htmlmod.escape(hid), htmlmod.escape(txt)))
    if in_group:
        parts.append('</div>')
    parts.append('</div></nav>')
    return '\n'.join(parts)


def main():
    assemble_answers()
    md_source, missing = assemble()
    if missing:
        print('MISSING SOURCES:', missing)

    protected, store = protect_math(md_source)
    protected = fix_empty_header_tables(protected)
    md = markdown.Markdown(extensions=['tables', 'fenced_code', 'toc', 'attr_list', 'sane_lists'],
                           extension_configs={'toc': {'toc_depth': '1-3',
                                                     'anchorlink': False,
                                                     'slugify': slugify}})
    body = restore_math(md.convert(protected), store)
    nav = build_nav(body)

    tpl = read(TEMPLATE)
    doc = (tpl.replace('{{NAV}}', nav)
              .replace('{{BODY}}', body)
              .replace('{{TITLE}}', '量子人工智能 · 第 P3 讲学习笔记讲义'))
    with open(OUT_HTML, 'w', encoding='utf-8') as f:
        f.write(doc)
    with open(OUT_MD, 'w', encoding='utf-8') as f:
        f.write(md_source)
    with open(os.path.join(SRC, '_math.json'), 'w', encoding='utf-8') as f:
        json.dump([{'display': d, 'tex': t} for d, t in store], f, ensure_ascii=False)

    print('math total=%d display=%d' % (len(store), sum(1 for d, _ in store if d)))
    print('html=%d bytes  md=%d bytes' % (os.path.getsize(OUT_HTML), os.path.getsize(OUT_MD)))


if __name__ == '__main__':
    main()
