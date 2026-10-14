# 撰写者任务书（每项撰写任务的通用验收标准）

> 本文件与 `tools/LECTURE_STYLE.md` 一起构成撰写任务的验收标准。
> 你的具体小节清单在 `tools/lectures.json`（按 `id` 查 `title` / `group` / `ppt` / `brief`）。

## 1. 写入范围（严格）

只允许创建/修改 **分配给你的** `pages/<slug>/src/<id>.md`。

**禁止**：修改其他 md、`tools/**`、`styles/**`、`pages/**/*.html`、`pages/study.html`；
**禁止**运行 `tools/build_lecture.py`（构建由 Lead 统一执行，并发写同一批 HTML 会冲突）。

## 2. 必读顺序

1. `tools/LECTURE_STYLE.md` —— 写作规范（硬性要求，含 Markdown/公式/标记/表格/ASCII 图写法）
2. `tools/lectures.json` —— 找到你的 `id`，读 `title` `group` `ppt` `brief`
3. 标杆样例：`pages/quantum-foundations/src/qf-01.md` —— **照这个质量与结构写**
4. 源课件提取结果：
   - P1：`C:\Users\12252\AppData\Local\Temp\qjys\P1\full.txt`（含 `===== PAGE N =====`）与 `...\P1\imgs\pNNN.png`
   - P2：`C:\Users\12252\AppData\Local\Temp\qjys\P2\full.txt` 与 `...\P2\imgs\pNNN.png`

⚠️ **PPT 导出的 PDF 中公式会被抽成散乱字符**。凡涉及公式、推导、矩阵、表格、框图的页，必须用 `read_image` 看对应 `pNNN.png` 后再写。

## 3. 每节验收标准（逐条自检）

| # | 标准 | 判定方式 |
|---|---|---|
| A1 | 文件存在于指定路径 | 文件系统 |
| A2 | 正文 4500–12000 字符（不含空白） | `check_md.py` 的篇幅项 |
| A3 | 覆盖该节 `brief` 与对应 PPT 页的**全部**知识点，关键段落标 `（PPT 第 N 页）` | 人工对照 `full.txt` |
| A4 | 公式全部真 LaTeX（`$...$` / `$$...$$`），无 Unicode 上下标 | `check_md.py` |
| A5 | 标题只用 `###` / `####` | `check_md.py` |
| A6 | 每个公式后跟一句「翻译成人话」；关键推导有手算例子 | 人工 |
| A7 | 术语首次出现给中英对照；补充内容用 `【补】`；课件笔误用 `【勘误】` | 人工 + 计数 |
| A8 | 禁用「显然」「易得」「同理可证」 | 人工 |
| A9 | 自测题答案用 `<details><summary>答案</summary>` 就地折叠 | 人工 |
| A10 | 无 `TODO`/待补/占位 | `check_md.py` |
| A11 | `check_md.py` 对你所有文件输出 `[OK]` 且**无错误行**（警告尽量清零） | 命令输出 |

## 4. 自查命令（必须执行）

```powershell
$py = "C:\Users\12252\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
cd G:\c项目\fxHook.io
& $py tools\check_md.py pages\quantum-foundations\src\qf-02.md pages\quantum-foundations\src\qf-03.md
```

## 5. 完成后必须上报（send_message 给 lead）

一行一条，包含：任务 id、完成文件数、每节字符数、`check_md.py` 是否有错误行、
以及你**不确定或有争议**的地方（例如课件某页公式读不出来、数字前后不一致）。

## 6. 反面案例（会直接返工）

- ❌ 只写「摘要」而丢掉课件的节次结构与推导。
- ❌ 用 Unicode 上下标硬写公式（`R_{i-1}` 写成 `Rᵢ₋₁`）。
- ❌ 公式页只读文本提取结果就动笔（会把公式写错）。
- ❌ 一次写完一整节却只有 1500 字符（太薄）。
- ❌ 留占位符、写「待补充」。
- ❌ 顺手改别人的文件或跑构建脚本。
