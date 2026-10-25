# 项目重构说明

## 重构日期
2025年11月3日

## 重构内容

### 新的目录结构

```
fxHook.io/
├── index.html                 # 主页（保持在根目录）
├── README.md                  
├── .htaccess                  
├── site.webmanifest          
├── pages/                     # 所有HTML页面
│   ├── communicate.html       # 联系方式/友链
│   ├── diary.html            # 日记页面
│   ├── picture.html          # 图片墙
│   └── study.html            # 学习笔记
├── components/                # 可复用组件
│   └── header.html           # 页面头部导航
├── assets/                    # 静态资源
│   ├── images/               # 图片资源
│   │   ├── avatar_me.jpg
│   │   ├── background.png
│   │   ├── tju.jpg
│   │   ├── maodie/          # 耄耋图片集
│   │   └── mocai/           # 魔审图片集
│   ├── icons/                # 网站图标
│   │   ├── favicon.ico
│   │   ├── favicon-16x16.png
│   │   ├── favicon-32x32.png
│   │   ├── apple-touch-icon.png
│   │   ├── android-chrome-192x192.png
│   │   └── android-chrome-512x512.png
│   ├── audio/                # 音频文件
│   │   └── BATTLEPLAN_ARCLIGHT.mp3
│   └── files/                # 文档文件
│       └── *.pdf             # 各种实验PDF
├── styles/                    # 样式文件
│   └── style.css
├── scripts/                   # JavaScript文件
│   ├── loadHeader.js
│   └── audioPlayer.js
└── docs/                      # 文档/教程
    └── cdn_using.html

```

## 主要改动

### 1. 文件移动
- ✅ **HTML页面**：`communicate.html`, `diary.html`, `picture.html`, `study.html` → `pages/`
- ✅ **组件文件**：`header.html` → `components/`
- ✅ **图标文件**：所有 `*.png`, `*.ico` → `assets/icons/`
- ✅ **图片资源**：`resources/img/*` → `assets/images/`
- ✅ **音频文件**：`resources/*.mp3` → `assets/audio/`
- ✅ **文档文件**：`resources/files/*` → `assets/files/`
- ✅ **教程文档**：`md/cdn_using.html` → `docs/`

### 2. 目录重命名
- ✅ `style/` → `styles/` (统一命名风格)

### 3. 路径更新

#### index.html (根目录)
```html
<!-- 旧路径 -->
<link rel="stylesheet" href="style/style.css">
<link rel="icon" href="/favicon-32x32.png">

<!-- 新路径 -->
<link rel="stylesheet" href="styles/style.css">
<link rel="icon" href="/assets/icons/favicon-32x32.png">
```

#### pages/*.html (子页面)
```html
<!-- 旧路径 -->
<link rel="stylesheet" href="style/style.css">
<script src="scripts/loadHeader.js"></script>
<img src="resources/img/avatar_me.jpg">

<!-- 新路径 -->
<link rel="stylesheet" href="../styles/style.css">
<script src="../scripts/loadHeader.js"></script>
<img src="../assets/images/avatar_me.jpg">
```

#### loadHeader.js
```javascript
// 旧代码
const isInSubfolder = window.location.pathname.includes('/md/');
const response = await fetch(`${pathPrefix}header.html`);

// 新代码
const isInSubfolder = window.location.pathname.includes('/pages/') || 
                      window.location.pathname.includes('/docs/');
const response = await fetch(`${pathPrefix}components/header.html`);
```

#### header.html (导航链接)
```html
<!-- 旧路径 -->
<li><a href="diary.html">日记</a></li>
<li><a href="study.html">学习笔记</a></li>

<!-- 新路径 -->
<li><a href="pages/diary.html">日记</a></li>
<li><a href="pages/study.html">学习笔记</a></li>
```

### 4. 清理工作
- ✅ 删除空目录：`resources/`, `md/`

## 优势

1. **更清晰的结构**：按功能分类，一目了然
2. **更好的维护性**：相关文件集中管理
3. **符合规范**：遵循现代Web项目最佳实践
4. **易于扩展**：新增内容有明确的存放位置

## 注意事项

- 所有外部CDN链接（jsDelivr等）保持不变
- Git历史记录保留，可通过 `git log --follow` 查看文件移动历史
- 建议在部署前本地测试所有页面和链接

### 相对路径约定（重要）

上面的示例中 `href="/assets/icons/favicon-32x32.png"` 这类**以 `/` 开头的站根绝对路径是错误的**，仓库里实际使用的是相对路径（`assets/...` / `../assets/...`）。

原因：GitHub Pages 的仓库站点部署在仓库名子路径下（如 `https://<user>.github.io/FuncBlog/`），
以 `/` 开头的路径会指向 `https://<user>.github.io/`，从而 404；自建站因为部署在域名根目录才“看起来正常”。

- HTML 内静态引用：按页面所在层级使用相对路径（`assets/...`、`../assets/...`、`../../assets/...`）。
- JS 里动态拼接路径：不要数 `location.pathname` 的层数来推站点根，应像 `scripts/header.js` 那样从脚本自身 URL 反推站点根。
- 新增页面时，所有链接都要同时验证“域名根目录部署”和“GitHub Pages 仓库子路径部署”两种情形。

## 后续建议

1. 考虑添加 `.gitignore` 文件
2. 可以进一步优化CSS，考虑分模块
3. 建议添加构建工具（如Vite）优化开发流程

---

# 第二轮重构：收敛渲染链（2026-10-25，分支 refactor/aggressive-test）

## 动机

改造前站点同时存在两套页面外壳实现：

- `scripts/header.js`：运行时 fetch/注入，服务 15 个手写页
- `build_lecture.py` 里的 `header_html()`：把 HTML 内联进 224 个生成页，并把
  `'../../index.html'` **写死**，导致这些页面必须恰好位于两层目录下
- 导航配置另有三个副本：`header.js` 的 `navItems`、`lectures.json` 的 `site.nav`、
  `components/header.html`（后者只被 `loadHeader.js` 引用，而它已无页面引用）

## 新增的三个工具

| 文件 | 作用 |
|---|---|
| `tools/site_shell.py` | header / footer 的**唯一渲染入口**；`rel_prefix(页面路径)` 按层级算 `../` |
| `tools/unify_shell.py` | 批量把既有静态页的外壳刷成统一样式；`--write` 才落盘 |
| `tools/check_links.py` | 全站链接检查：死链 / 大小写不匹配 / 跳出根 / `/` 开头的站根绝对路径 |

## 新的路径约定（在旧约定之上收紧）

导航配置只有一份，在 `tools/lectures.json` 的 `site.nav`。其中 `href` **一律写相站点根的路径**：

```json
{ "href": "index.html", "text": "首页" },
{ "href": "pages/diary.html", "text": "日记" }
```

渲染时由 `site_shell.rel_prefix()` 补前缀，所以同一份配置在任意深度都成立：

```
index.html                          prefix ''         -> pages/diary.html
pages/study.html                    prefix '../'      -> ../pages/diary.html
pages/crypto-hash-rsa/index.html    prefix '../../'   -> ../../pages/diary.html
```

**不要**再在模板里写死 `../../`，也不要写以 `/` 开头的站根绝对路径。

## 日常操作

```bash
# 改导航：只改 lectures.json，然后
python tools/build_lecture.py      # 重建 2 套量子讲义（覆盖生成的 68 页）
python tools/unify_shell.py --write  # 刷新 crypto 那 153 页（它们没有 md 源）

# 改完必跑
python tools/check_links.py --all
python tools/unify_shell.py        # 应输出"外壳一致"
```

## 已验证的性质

- `build_lecture.py` 全量重建**逐字节可复现**（12 秒，`git diff` 为空），可用于判断改动是否只落在预期处
- 223 个内联 header 在归一化 `../` 后原本就完全相同，因此统一后每页只变 6 行（5 条导航 + 1 条页脚），结构零改动
- 改完 `check_links.py`：250 页 / 16471 条站内链接，0 死链（唯一 1 条在待删的测试页 `pages/index_dev.html`）

## 尚未完成

- 那 15 个走 `scripts/header.js` 的手写页还没换成静态外壳，`header.js` 与 `components/header.html`、`loadHeader.js` 仍未删除
- head 里的图标 / 样式表引用仍是各页硬编码的 `../../`，未纳入 site_shell
- 遗留测试页与 `assets/files/bridge_server.exe`、重复的 `assets/img` 未清理
