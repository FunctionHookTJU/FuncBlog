#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""站点外壳（header / footer）的唯一渲染入口。

设计要点
--------
导航与页脚的**唯一事实来源**是 `tools/lectures.json` 的 `site` 段，其中 href 一律写成
**相对站点根**的形式（`index.html`、`pages/diary.html`）。

渲染时用 `rel_prefix()` 按"页面相对仓库根的层级"算出 `../` 串，再拼到根相对路径前面。
这样同一份配置在任意深度的页面都成立：

    index.html                     prefix ''      -> pages/diary.html
    pages/study.html               prefix '../'   -> ../pages/diary.html
    pages/quantum-foundations/x.html  prefix '../../' -> ../../pages/diary.html

**不要**再在模板里写死 `../../`（旧 build_lecture.py 就是这么干的，导致 223 个页面
必须恰好位于两层目录下，一挪目录全站断链）。也不要写以 `/` 开头的站根绝对路径
（GitHub Pages 部署在仓库名子路径下会 404，见 REFACTORING.md）。

消费者
------
* `tools/build_lecture.py`  —— 生成量子讲义时调用
* `tools/unify_shell.py`     —— 批量校正既有静态页（crypto 那 153 页没有 md 源，
                                只能靠它把外壳刷成同一份）
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT, "tools", "lectures.json")

SITE_NAME = "宇佐见函钩"
AVATAR = "assets/images/avatar_me.jpg"
COPYRIGHT = ('© 2025 宇佐见函钩. 保留所有权利. | '
             '<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">'
             '津ICP备2026001436号</a>')

# 页脚固定链接（根相对）
FOOTER_LINKS = [
    ("关于我", "index.html#about"),
    ("B站空间", "index.html#bilibili"),
    ("返回学习笔记", "pages/study.html"),
]

SVG_DEFS = """<svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <defs>
        <clipPath id="liquid-tab" clipPathUnits="objectBoundingBox">
            <path d="M 0.03 0 L 0.97 0 L 0.97 0.05 C 0.92 0.06 0.88 0.13 0.86 0.20 L 0.86 0.78 Q 0.86 1 0.74 1 L 0.26 1 Q 0.14 1 0.14 0.78 L 0.14 0.20 C 0.12 0.13 0.08 0.06 0.03 0.05 Z"/>
        </clipPath>
    </defs>
</svg>"""


def load_site():
    with open(CONFIG_PATH, encoding="utf-8") as fh:
        return json.load(fh)["site"]


def page_depth(rel_path):
    """页面相对仓库根的目录层级数。'a/b/c.html' -> 2。"""
    rel = rel_path.replace("\\", "/").strip("/")
    return rel.count("/")


def rel_prefix(rel_path):
    """当前页面回到站点根所需的 '../' 串。"""
    return "../" * page_depth(rel_path)


def nav_items(site=None):
    site = site or load_site()
    return site["nav"]


def render_header(prefix, nav=None):
    """prefix: 回到站点根的 '../' 串；nav: lectures.json 的 site.nav（根相对 href）。"""
    items = []
    for it in (nav if nav is not None else nav_items()):
        attrs = ""
        if it.get("active"):
            attrs += ' class="active"'
        if it.get("external"):
            attrs += ' target="_blank" rel="noopener noreferrer"'
        href = it["href"] if it.get("external") else prefix + it["href"]
        items.append('                <li><a href="%s"%s>%s</a></li>' % (href, attrs, it["text"]))
    items.append("""            <li id="mute-button-container">
                <button id="mute-button" class="icon-btn" title="静音/取消静音" aria-label="静音/取消静音">🔊</button>
            </li>
            <li id="toggle-audio-source-container">
                <button id="toggle-audio-source" class="icon-btn" title="切换音频源" aria-label="切换音频源">🎵1</button>
            </li>""")
    return """<header>
    <nav>
        <a class="logo" href="%(prefix)sindex.html">
            <img class="logo-avatar" src="%(prefix)s%(avatar)s" alt="%(name)s头像">
            <span class="logo-text">%(name)s</span>
        </a>
        <ul class="nav-links">
%(items)s
        </ul>
        <div class="mobile-menu-btn" id="mobile-menu-btn">
            <span></span>
            <span></span>
            <span></span>
        </div>
    </nav>
</header>""" % {
        "prefix": prefix,
        "avatar": AVATAR,
        "name": SITE_NAME,
        "items": "\n".join(items),
    }


def render_footer(prefix):
    links = "\n".join(
        '            <a href="%s%s">%s</a>' % (prefix, href, text)
        for text, href in FOOTER_LINKS
    )
    return """<footer class="site-footer">
    <div class="footer-content">
        <div class="footer-links">
%s
        </div>
        <p class="copyright">%s</p>
    </div>
</footer>""" % (links, COPYRIGHT)


def render_shell(prefix, nav=None, with_svg_defs=True):
    """一次拿到整套外壳（SVG 定义 + header）。"""
    head = (SVG_DEFS + "\n") if with_svg_defs else ""
    return head + render_header(prefix, nav)


if __name__ == "__main__":  # 自检：同一份配置在不同深度都指向同一批文件
    for p in ("index.html", "pages/study.html", "pages/quantum-foundations/x.html"):
        print("%-34s prefix=%-8r  日记链接 -> %s"
              % (p, rel_prefix(p), rel_prefix(p) + "pages/diary.html"))
