## 附录 A 术语中英对照表

本表覆盖全篇出现的主要术语，按主题分四组。每个术语给英文写法和一句话解释；正文里第一次遇到某个术语时，可以回到这里确认它到底指什么。中文术语后括号内的英文，与正文首次出现时的写法一致。

### A.1 量子力学基础

| 术语 | 英文 | 一句话解释 |
|---|---|---|
| 量子比特 | qubit | 二维复希尔伯特空间中的一个态，是经典比特的量子对应物。 |
| 态矢 | state vector | 描述纯量子态的复向量，狄拉克记号写作 $\lvert\psi\rangle$。 |
| 概率幅 | probability amplitude | 态矢在某个基上的复系数，其模平方给出测量概率。 |
| 叠加 | superposition | 态是若干基态的复系数线性组合，而不是"其中某一个"。 |
| 归一化 | normalization | 要求概率幅模平方之和为 1，使总概率等于 1。 |
| 整体相位 | global phase | 给整个态乘上 $e^{i\theta}$，不改变任何测量统计。 |
| 相对相位 | relative phase | 两个分量之间的相位差，会改变干涉结果，因而是可观测的。 |
| 希尔伯特空间 | Hilbert space | 完备的内积复向量空间，量子态居住的地方；有限维时就是 $\mathbb{C}^d$。 |
| 内积 | inner product | 两个态矢的配对运算 $\langle\phi\vert\psi\rangle$，给出复数和"重叠程度"。 |
| 共轭转置 | conjugate transpose | 转置后再取复共轭，记作 $\dagger$，是狄拉克记号里 bra 与 ket 的转换。 |
| 幺正算符 | unitary operator | 满足 $U^{\dagger}U=I$ 的算符，描述封闭系统的演化并保持内积。 |
| 厄米算符 | Hermitian operator | 满足 $A^{\dagger}=A$ 的算符，对应可观测量，特征值为实数。 |
| 可观测量 | observable | 可以被测量的物理量，在形式上是一个厄米算符。 |
| 谱分解 | spectral decomposition | 把厄米算符写成 $\sum_k\lambda_k\lvert v_k\rangle\langle v_k\rvert$ 的形式。 |
| 特征值 / 特征向量 | eigenvalue / eigenvector | 算符作用后只被伸缩的方向及其伸缩倍数，对应测量读数与测后态。 |
| 张量积 | tensor product | 把两个子系统拼成复合系统的运算 $\otimes$，维数相乘。 |
| 投影测量 | projective measurement | 用一组正交投影算符 $\{P_m\}$ 提问的测量方式。 |
| Born 规则 | Born rule | 测量得到结果 $m$ 的概率为 $\langle\psi\vert P_m\vert\psi\rangle$。 |
| 测量塌缩 | collapse | 测量后态被投影到与结果对应的特征子空间并重新归一化。 |
| 期望值 | expectation value | 各可能读数按概率加权的平均，$\langle A\rangle=\langle\psi\vert A\vert\psi\rangle$。 |
| 方差 | variance | 读数偏离期望值的程度，$\Delta A^2=\langle A^2\rangle-\langle A\rangle^2$。 |
| 对易子 | commutator | $[A,B]=AB-BA$；为零表示两算符可同时对角化。 |
| 不兼容测量 | incompatible measurement | 不对易的测量，没有共同本征基，不能同时有确定值。 |
| 不确定性关系 | uncertainty relation | 不对易量的方差乘积有下界 $\Delta A\,\Delta B\ge\frac12\lvert\langle[A,B]\rangle\rvert$。 |
| Bloch 球 | Bloch sphere | 单量子比特纯态的一一对应球面表示，纬度定 0/1 比例、经度定相位。 |
| 纯态 | pure state | 可以用单个态矢（或秩一投影算符）描述的态。 |
| 混合态 | mixed state | 若干纯态按概率混合得到的态，需要用密度矩阵描述。 |
| 密度矩阵 | density matrix | $\rho=\sum_i p_i\lvert\psi_i\rangle\langle\psi_i\rvert$，统一描述纯态与混合态。 |
| 纯度 | purity | $\mathrm{Tr}(\rho^2)$；等于 1 为纯态，小于 1 为混合态。 |
| 部分迹 | partial trace | 对复合系统的一个子系统求迹，得到另一个子系统的约化密度矩阵。 |
| 约化密度矩阵 | reduced density matrix | $\rho_A=\mathrm{Tr}_B\,\rho_{AB}$，只描述 A 边可观测的统计。 |
| 冯·诺依曼熵 | von Neumann entropy | $S(\rho)=-\mathrm{Tr}(\rho\log_2\rho)$，度量密度矩阵的不确定程度。 |
| 复合系统 | composite system | 由多个子系统张量积构成的整体系统。 |
| 量子纠缠 | quantum entanglement | 复合系统的纯态不能写成子系统张量积的现象。 |
| 可分态 | separable state | 可以写成乘积态凸组合的态，没有纠缠。 |
| 乘积态 | product state | 形如 $\lvert\phi\rangle_A\otimes\lvert\chi\rangle_B$ 的态。 |
| 贝尔态 | Bell state | 两比特最大纠缠的四个正交态，如 $\lvert\Phi^{\pm}\rangle,\lvert\Psi^{\pm}\rangle$。 |
| 施密特分解 | Schmidt decomposition | 把两体纯态写成 $\sum_k\sqrt{\lambda_k}\lvert u_k\rangle\lvert v_k\rangle$，非零项多于一个即纠缠。 |
| 纠缠熵 | entanglement entropy | 约化密度矩阵的冯·诺依曼熵，Bell 态为 1 比特。 |
| 纠缠判据 | entanglement criterion | 判断是否纠缠的条件；本讲义只用纯态的"约化密度矩阵不纯"判据。 |
| 上下文性 | contextuality | 测量统计依赖于同一组中还有哪些兼容测量被一起执行。 |
| Kochen–Specker 定理 | Kochen–Specker theorem | 维数不小于 3 时，不存在对所有投影算符的非上下文 0/1 赋值。 |
| 无信号原理 | no-signaling | 一端的边际统计不随另一端测量选择改变，保证纠缠不能超光速传信。 |
| 量子非克隆定理 | no-cloning theorem | 未知量子态不能被精确复制。 |
| 惠勒延迟选择 | Wheeler's delayed choice | 事后再决定测量方式，仍会影响对先前路径行为的统计描述。 |
| 量子逻辑 | quantum logic | 以希尔伯特子空间格替代布尔代数、分配律一般不成立的非经典逻辑。 |

### A.2 概率、信息与统计

| 术语 | 英文 | 一句话解释 |
|---|---|---|
| 样本空间 | sample space | 全部可能结果的集合 $\Omega$。 |
| 随机事件 | event | 样本空间的子集，即"发生了某件事"的集合表示。 |
| σ-代数 | sigma-algebra | 对补集和可数并封闭的事件族 $\mathcal{F}$，界定哪些事件可赋概率。 |
| 可测集 | measurable set | 属于 $\sigma$-代数、因而可以赋概率的集合。 |
| 概率测度 | probability measure | 定义在 $\mathcal{F}$ 上、满足三公理、取值于 $[0,1]$ 的函数 $P$。 |
| Kolmogorov 概率公理 | Kolmogorov axioms | 非负、规范、可列可加三条公理，经典概率的底座。 |
| 联合分布 | joint distribution | 多个随机变量取值的整体概率分布。 |
| 联合可测 | joint measurability | 存在一个联合分布能同时导出所有相关的边际分布。 |
| 边缘分布 / 边缘化 | marginal distribution / marginalization | 把不关心的变量求和掉，得到关心变量的分布。 |
| 条件概率 | conditional probability | $P(A\mid B)=P(A\cap B)/P(B)$，已知 B 发生后 A 的概率。 |
| 独立性 | independence | 满足 $P(A\cap B)=P(A)P(B)$ 的两个事件。 |
| 贝叶斯公式 | Bayes' rule | 由先验和似然反推后验的公式。 |
| 概率不兼容性 | probabilistic incompatibility | 两两边际分布都合法，却不存在能同时导出它们的联合分布。 |
| 非经典概率 | non-Kolmogorovian probability | 放弃（可数）联合可测、只在上下文中赋概率的概率框架。 |
| 隐变量 | hidden variable | 假定存在但未直接观测的额外变量，用来解释统计相关。 |
| 局域隐变量模型 | local hidden variable model (LHV) | 假定两端结果由各自事先带好的"答案表"决定的模型。 |
| 贝尔不等式 | Bell inequality | 任何 LHV 都必须满足、而量子力学可以违背的一类不等式。 |
| CHSH 不等式 | CHSH inequality | 两方两测量情形下的贝尔不等式，LHV 下 $\lvert S\rvert\le2$。 |
| Tsirelson 界 | Tsirelson bound | 量子关联允许的 CHSH 上限 $\lvert S\rvert\le2\sqrt2$。 |
| 上下文干涉 | contextual interference | 认知判断随语境变化、类似量子干涉的现象。 |
| Reichenbach 原则 | Reichenbach's principle | 统计相关必由共同原因或直接因果解释，形式为条件独立。 |
| 休谟怀疑论 | Hume's skepticism | 由经验与统计相关无法逻辑必然地推出因果律。 |
| 信息瓶颈 | information bottleneck | 在压缩表示与保留任务相关信息之间的权衡。 |
| 量子认知 | quantum cognition | 用希尔伯特空间与非经典概率建模认知现象的研究方向。 |
| 量子认知表示系统 | quantum cognitive representation system | 以量子态、演化和测量为骨架的知识表示与推理系统。 |

### A.3 人工智能与复杂性

| 术语 | 英文 | 一句话解释 |
|---|---|---|
| 前馈神经网络 | feedforward neural network | 信息单向逐层传递、无回路的神经网络。 |
| 激活函数 | activation function | 神经元线性输出后的非线性变换，如 ReLU。 |
| ReLU | rectified linear unit | $\max(0,z)$，把负值截零的分段线性激活函数。 |
| 隐藏层 | hidden layer | 输入与输出之间、不直接对应观测量的网络层。 |
| 特征表示层 | feature representation layer | 把输入重新编码为中间特征的层，多任务时常被共享。 |
| 反向传播 | backpropagation | 用链式法则从损失往回逐层计算梯度的算法。 |
| 梯度下降 | gradient descent | 沿负梯度方向更新参数以降低损失的优化方法。 |
| 损失函数 | loss function | 度量预测与目标差距的函数，训练的目标就是最小化它。 |
| 梯度竞争 | gradient competition | 多个任务对共享参数的梯度方向相反、互相抵消的现象。 |
| 多任务学习 | multi-task learning | 多个任务共享部分表示或参数的训练方式。 |
| 过拟合 | overfitting | 训练误差小而测试误差大，模型记住了训练样本。 |
| 泛化 | generalization | 模型在未见数据上仍表现良好的能力。 |
| 归纳偏置 | inductive bias | 学习算法对"哪类规律更可能"的偏好，是泛化的前提。 |
| No Free Lunch 定理 | No Free Lunch theorem | 遍历所有问题时没有万能算法，无归纳偏置的算法无用。 |
| 边角案例 | corner case | 分布边缘、罕见且模型容易出错的输入情形。 |
| 残差网络 | ResNet | 用残差连接缓解深层网络退化问题的卷积网络结构。 |
| 异或网络 | XORnet | 能计算异或的最小 ReLU 前馈网络，NCnet 的构造基础。 |
| 非经典网络 | NCnet | 基于 XORnet 构造、可呈现违背 CHSH 不等式统计特征的前馈网络。 |
| 语义网络 | semantic network | 用节点和边表示概念及其关系的知识表示结构。 |
| 知识图谱 | knowledge graph | 以实体—关系三元组组织的大规模结构化知识库。 |
| 本体论 | ontology | 用类、属性和关系对领域概念做形式化规约的体系。 |
| 因果发现 | causal discovery | 从观测或干预数据中推断因果关系结构的方法。 |
| 量子因果发现 | quantum causal discovery | 利用量子观察机制与量子关联区分因果与共同原因的方法。 |
| 预训练 | pretraining | 在大规模语料上先训练通用模型、再针对任务微调的两阶段范式。 |
| 灾难性遗忘 | catastrophic forgetting | 学习新任务时旧任务能力急剧下降的现象。 |
| 幻觉 | hallucination | 大模型生成看似合理但与事实不符内容的现象。 |
| 判定问题 | decision problem | 输出为"是/否"的计算问题，复杂性类讨论的标准对象。 |
| P | polynomial time | 存在确定性多项式时间算法判定的问题类。 |
| NP | nondeterministic polynomial time | 给定证书可在多项式时间内验证的问题类。 |
| BQP | bounded-error quantum polynomial time | 量子计算机可在多项式时间内以有界错误概率判定的问题类。 |
| 量子加速 | quantum speedup | 相对最优经典算法的渐进加速，Shor 算法是指数级例子。 |

### A.4 课程专有名词

| 术语 | 英文 | 一句话解释 |
|---|---|---|
| 量子语言模型 | quantum language model (QLM) | 把词与文本映射为希尔伯特空间中的态、用测量建模语义的语言模型。 |
| 无条件纯依赖 | unconditional pure dependence (UPD) | 联合分布不能分解为任何低阶边际之积；课件证明纯态纠缠与其特征分布 UPD 等价。 |
| 惊奇考试悖论 | surprise exam paradox | "考前不能断定考试日期"的消息经经典逻辑推理导出矛盾，但考试照常举行。 |
| Gödel 型命题 | Gödel sentence | 精确陈述自身在系统内不可证、因而直觉为真的命题。 |
| 有限理性 | bounded rationality | 决策者受计算与信息限制、不追求最优的行为假设。 |
| 高阶语义 | high-order semantics | 多个词之间的依赖不能分解为低阶依赖的语义现象，如"拿破仑在滑铁卢遭受决定性失败"。 |
| 量子信息检索 | quantum information retrieval | 用量子概率框架建模查询—文档相关性与检索排序的方向。 |
| 认知干涉 | cognitive interference | 认知判断中类似量子干涉的非经典概率效应。 |
| 语义空间 | semantic space | 承载词义或概念表示的向量/态空间。 |
| 隐式信息传递 | implicit information transfer | 无显式连接路径的两端，通过共享资源的训练动态相互影响。 |
