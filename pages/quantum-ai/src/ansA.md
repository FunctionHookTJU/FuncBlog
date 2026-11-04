### 第 0 章 前置知识补课

Q 0.1 验证 $H$ 幺正，计算 $H|0\rangle$、$H|1\rangle$、$H(H|0\rangle)$，并解释干涉

A：$H^{\dagger}=H$，且 $H^2=\frac12\begin{pmatrix}2&0\\0&2\end{pmatrix}=I$，所以 $H^{\dagger}H=I$，$H$ 幺正。$H|0\rangle=|+\rangle$，$H|1\rangle=|-\rangle$，$H(H|0\rangle)=H|+\rangle=|0\rangle$。若两个分支只是各 $1/2$ 的经典概率混合，经过 $H$ 后仍是五五开，不会确定地回到 $|0\rangle$；能回到 $|0\rangle$ 说明两条路径的概率幅相干叠加，交叉项 $2\,\mathrm{Re}(a^{*}b)$ 不为零，这就是干涉。

Q 0.2 判断三个密度矩阵的纯态/混合态，计算 $\mathrm{Tr}(\rho^2)$ 与熵

A：$\rho_1$：$\rho_1^2=\rho_1$，$\mathrm{Tr}(\rho_1^2)=1$，纯态，$S=0$。$\rho_2=I/2$：$\mathrm{Tr}(\rho_2^2)=1/2$，混合态，特征值 $(\frac12,\frac12)$，$S=1$ 比特。$\rho_3=\mathrm{diag}(0.9,0.1)$：$\mathrm{Tr}(\rho_3^2)=0.81+0.01=0.82$，混合态，$S=-0.9\log_2 0.9-0.1\log_2 0.1\approx0.469$ 比特。判据是 $\mathrm{Tr}(\rho^2)=1$ 当且仅当纯态。

Q 0.3 对 $|\Psi^{-}\rangle$ 求 $\rho_A$、$\mathrm{Tr}(\rho_A^2)$、纠缠熵，判断是否纠缠

A：$|\Psi^{-}\rangle$ 的密度矩阵交叉项经部分迹后因 $\langle1|0\rangle=0$ 消失，只剩对角项，得 $\rho_A=\frac12|0\rangle\langle0|+\frac12|1\rangle\langle1|=I/2$。于是 $\mathrm{Tr}(\rho_A^2)=1/2$，$S(\rho_A)=1$ 比特。整体是纯态而约化态是混合态，按两体纯态的纠缠判据，$|\Psi^{-}\rangle$ 是纠缠态。

Q 0.4 取 $B_1=\sigma_z$、$B_2=\sigma_x$ 计算 CHSH 的 $S$，并解释

A：$\mathbb{E}(A_1B_1)=\langle\sigma_z\otimes\sigma_z\rangle=1$，$\mathbb{E}(A_1B_2)=\langle\sigma_z\otimes\sigma_x\rangle=0$，$\mathbb{E}(A_2B_1)=\langle\sigma_x\otimes\sigma_z\rangle=0$，$\mathbb{E}(A_2B_2)=\langle\sigma_x\otimes\sigma_x\rangle=1$，所以 $S=1+0+0-1=0$。它既不超过 2，也远低于 $2\sqrt2$，不构成违背。要违背经典界，需要让 A、B 的测量方向错开约 $45^\circ$（如 $B_1=(\sigma_z+\sigma_x)/\sqrt2$、$B_2=(\sigma_z-\sigma_x)/\sqrt2$），使四项同号叠加到 $2\sqrt2$。

Q 0.5 证明三个布尔变量不存在联合分布

A：设 $p_{abc}$ 是联合分布。由 $\Pr(B=1,C=0)=0.35$ 得 $p_{010}+p_{110}=0.35$，故 $p_{110}\le0.35$；由 $\Pr(A=1,B=1)=1$ 得 $p_{110}+p_{111}=1$，故 $p_{111}\ge0.65$。又由 $\Pr(B=1,C=1)=0.3$ 得 $p_{011}+p_{111}=0.3$，故 $p_{111}\le0.3$。于是 $0.65\le p_{111}\le0.3$，矛盾，联合分布不存在。

Q 0.6 梯度为 +2 与 -2 时 w 如何变；解释梯度竞争、隐式信息传递与归纳偏置

A：总梯度为 $\partial L_1/\partial w+\partial L_2/\partial w=+2-2=0$，梯度下降后 $w$ 不变，两个任务都没有改进。NCnet 中两端共享特征表示层，同时训练 $\alpha_2$、$\beta_2$ 时梯度相互抵消，训练误差振荡不收敛；一端观察到这种振荡就能推测另一端在做什么任务，于是形成没有显式路径的"隐式信息传递"，模型不再等价于 LHV。共享表示本身是一种归纳偏置，No Free Lunch 说明偏置不可消除、只能选择；偏置与任务不匹配时，就表现为梯度竞争。


