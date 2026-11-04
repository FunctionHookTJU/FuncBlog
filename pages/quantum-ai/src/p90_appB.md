## 附录 B 关键常数与公式速查

这一页是给复习用的。考前只看这一页，也应当能回忆起全篇的骨架。

### B.1 三个界：本讲最重要的三个数字

| 量 | 值 | 含义 | 谁给的 |
|---|---|---|---|
| CHSH 经典上界 | $\lvert S\rvert \le 2$ | 任何"结果在测量前就定好"的局域隐变量模型（LHV）都逃不出这个界 | Bell 不等式 / CHSH 形式化 |
| Tsirelson 界 | $\lvert S\rvert \le 2\sqrt{2} \approx 2.828$ | 量子力学允许的最大违背幅度 | 量子力学（Tsirelson 1980） |
| 本讲课件的两个实测 | $S \approx 3.5$（XORnet/NCnet）；$S = 2.334$（ResNet） | 纯经典神经网络也能越过 2，第一个甚至越过 $2\sqrt{2}$ | 课件 PPT 第 29、34 页 |

读到第三行，正确反应不是"量子力学错了"，而是：**"Bell 不等式的前提（LHV）在这些模型里不成立"**。越过 2 说明模型不再等价于 LHV；越过 $2\sqrt{2}$ 说明它连"量子可实现"都不是——它是一个更一般的非经典关联。这一点课件没有明说，但它是理解第 2 章的关键（PPT 第 29–32 页）。

### B.2 CHSH 统计量与四个期望值

$$S = \mathbb{E}(A_1B_1) + \mathbb{E}(A_1B_2) + \mathbb{E}(A_2B_1) - \mathbb{E}(A_2B_2)$$

其中 $A_i, B_j \in \{+1, -1\}$，$\mathbb{E}$ 表示数学期望。

课件 ResNet 算例（PPT 第 34 页）：

| 任务对 | 左端准确率 | 右端准确率 | $E$ 值 |
|---|---|---|---|
| $A_1, B_1$ | 99.74% | 99.74% | 0.9939 |
| $A_1, B_2$ | 99.89% | 88.89% | 0.7758 |
| $A_2, B_1$ | 99.98% | 92.59% | 0.8519 |
| $A_2, B_2$ | 85.71% | 64.29% | 0.2857 |

求和：$0.9939 + 0.7758 + 0.8519 - 0.2857 = 2.3359$，课件写作 $2.334$（四舍五入，差 $0.002$）。注意第四项是**减**号，它才是把 $S$ 压下来的那一项；而恰恰是 $A_2$ 与 $B_2$ 这一对（两个最"抢占"同一批特征的任务）双双崩掉准确率——这就是"梯度竞争"留下的指纹。

### B.3 量子信息最小公式表

| 名称 | 公式 | 一句话 |
|---|---|---|
| 归一化 | $\lvert\alpha\rvert^2 + \lvert\beta\rvert^2 = 1$ | 概率加起来必须是 1 |
| 量子比特 | $\lvert\psi\rangle = \alpha\lvert 0\rangle + \beta\lvert 1\rangle$ | 两个复数系数的单位向量 |
| Born 规则 | $p(m) = \langle\psi\lvert M_m^{\dagger}M_m\rvert\psi\rangle$ | 测量概率 = 算符夹在态中间 |
| 投影测量（完备性） | $\sum_m M_m^{\dagger}M_m = I$ | 所有结果概率和 = 1 的来源 |
| 密度矩阵 | $\rho = \sum_i p_i\lvert\psi_i\rangle\langle\psi_i\rvert$ | 混合态的通用记法 |
| 纯态判据 | $\operatorname{Tr}(\rho^2) = 1$ | 等于 1 是纯态，小于 1 是混合态 |
| 约化密度矩阵 | $\rho_A = \operatorname{Tr}_B(\rho_{AB})$ | 只看 A 端时把 B 端"求和掉" |
| 冯诺依曼熵 | $S(\rho) = -\operatorname{Tr}(\rho\log_2\rho)$ | 不确定性 / 纠缠的度量 |
| 幺正演化 | $U^{\dagger}U = I$ | 保证概率总和不变（可逆、保内积） |
| 厄米算符 | $A^{\dagger} = A$ | 可观测量必须是厄米的（保证结果是实数） |
| 对易子 | $[A,B] = AB - BA$ | 为 0 才可同时精确测量 |
| 不确定关系 | $\Delta A\,\Delta B \ge \tfrac{1}{2}\lvert\langle[A,B]\rangle\rvert$ | 不对易就必然有不确定 |

### B.4 常用矩阵与 Bell 态

泡利矩阵：

$$\sigma_x = \begin{pmatrix}0 & 1\\ 1 & 0\end{pmatrix},\qquad
\sigma_z = \begin{pmatrix}1 & 0\\ 0 & -1\end{pmatrix},\qquad
H = \frac{1}{\sqrt{2}}\begin{pmatrix}1 & 1\\ 1 & -1\end{pmatrix}$$

Bell 态（最大纠缠的四个正交态）：

$$\lvert\Phi^{\pm}\rangle = \frac{1}{\sqrt{2}}\big(\lvert 00\rangle \pm \lvert 11\rangle\big),\qquad
\lvert\Psi^{\pm}\rangle = \frac{1}{\sqrt{2}}\big(\lvert 01\rangle \pm \lvert 10\rangle\big)$$

第 4 章消解惊奇考试悖论用的就是 $a\lvert 00\rangle + b\lvert 11\rangle$ 这一族——注意它不一定是 $\lvert\Phi^+\rangle$，只要 $a,b \ne 0$ 就是纠缠态。

### B.5 概率公理速查

**Kolmogorov 三元组** $(\Omega, \mathcal{F}, P)$：

- $\Omega$：非空样本空间；
- $\mathcal{F} \subseteq 2^{\Omega}$：事件族，须满足 (i) $\Omega \in \mathcal{F}$；(ii) $A \in \mathcal{F} \Rightarrow (\Omega \setminus A) \in \mathcal{F}$；(iii) $A_i \in \mathcal{F} \Rightarrow \bigcup_{i=1}^{\infty} A_i \in \mathcal{F}$（可数并封闭）。由 De Morgan 律可推出可数交也封闭；
- $P: \mathcal{F} \to [0,1]$：概率测度，须满足非负性、$P(\Omega)=1$、可数可加性。

课件列出的四条推论（PPT 第 68 页）：

- (a) $P(\varnothing) = 0$
- (b) 对任意 $A \in \mathcal{F}$，$P(A) \le 1$
- (c) $P(A \cup B) = P(A) + P(B) - P(A \cap B)$
- (d) $P(A \cap B) = P(A \cap B \cap C) + P(A \cap B \cap (\Omega \setminus C))$

**民意调查算例**（PPT 第 19 页）的三个边际：

$$\Pr(A=1,B=1)=1,\qquad \Pr(A=1,C=1)=1,$$
$$\Pr(B=1,C=0)=\Pr(B=0,C=1)=0.35,\qquad \Pr(B=1,C=1)=0.3$$

不存在任何三元联合分布 $P(A,B,C)$ 能同时给出这四个数。证明见第 2 章 `2.7`。

### B.6 两种非经典概率的对照

| 对象 | 2 维系统（PPT 74） | 3 维系统（PPT 76） |
|---|---|---|
| $\mathcal{F}$ 封闭性 | 含 $\Omega$；对补封闭 | 含 $\Omega$；对补封闭；三元补存在性（存在两两不交的 $B,C$ 使 $A\cup B\cup C = \Omega$） |
| $P$ 的约束 | $P(\Omega)=1$；互补可加性 | $P(\Omega)=1$；互补可加性；三元补可加性 |
| 对应的量子系统 | qubit（每个事件 = 一条过原点的直线） | qutrit（三结果测量） |
| 相对 Kolmogorov 删掉了什么 | 可数并封闭（即放弃"所有事件联合可测"） | 同上，且只要求 3 个一组相容 |

记住这张表的读法：**非经典概率不是"概率不对了"，而是"哪些事件可以放在同一个概率空间里"这个前提被放松了。**放松的代价是无法再讨论全局联合分布，收益是能描述不兼容测量。

### B.7 课件出现的关键数值与事实

| 项目 | 数值 / 结论 | 页码 |
|---|---|---|
| 量子认知相关论文规模 | CCF 推荐期刊会议上已发表 100 篇以上 | 43 |
| ECIR 最佳 poster | 2011 年 | 43 |
| Busemeyer 获实验心理学最高奖 | 2015 年 | 43 |
| 量子信息检索首发 SIGIR / IJCAI | 2013 / 2015 年 | 43 |
| 量子信息获取国家重点研发项目启动 | 2018 年 | 43 |
| 不可测集在数学上广泛存在、物理上不现实 | 结论 | 71、73 |
| Ried 等量子因果特例结果 | Nature Physics 2015 | 82 |
| 本组量子因果一般化 | PRA 2018（胡明迪等）、PRA 2020（张晨光等） | 83、84 |
| 量子语义（UPD）成果 | ICTIR 2011 最佳论文奖；TOIS、IJCAI 2015 | 90 |
| 物理实现合作方 | 中科大量子信息重点实验室、苏黎世联邦理工学院（ETH） | 85 |

### B.8 一条必须记住的反例链

第 2 章用了整整六页建立这个反例，值得单独速记：

```text
   二分类任务 → ReLU 前馈网 → 两个顶层神经元不通信
        ↓
   交换一批批任务组合，记录训练是否成功
        ↓
   把"成功"编码成 A_i, B_j ∈ {+1,-1}
        ↓
   算 S = E(A1B1)+E(A1B2)+E(A2B1)-E(A2B2)
        ↓
   实测 S = 3.5 > 2（甚至 > 2√2）→ 不存在能解释它的 LHV
        ↓
   唯一可能的"通信"通道：反向传播把"另一端在干什么"泄露成梯度/误差的振荡
```

这条链完整地说明了一件事：**非经典性不需要量子硬件，它只需要"不兼容的测量"—**在这个例子里，后者表现为"共享同一批特征表示资源的任务对，互相改变对方的可训练性"。

