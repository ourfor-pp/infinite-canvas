# MiniMax H3 官方提示指南入口

以下是官方原文，不再用本地摘要替代。来源为 `MiniMax-AI/MiniMax-H3`，固定 revision：`d21241f0a4b3acbb34c97dae47fa417b7065e438`。

编写或重做 H3 提示时，先重新读取当前入口与对应全文，包括完整示例；旧对话中的摘要或旧提示不能替代阅读。Ref2VA 的共享摄影、动作、对白和声音规则也来自基础指南。

1. 阅读 [官方 Skill 原文](official-h3/upstream-skill.md)。它作为参考文件分发，不注册第二个媒体 Skill；原文中的相对路径以该文件所在目录为准。
2. 所有模式阅读 [基础指南全文](official-h3/references/base-en.txt)。
3. Ref2VA 另外阅读 [全参考指南全文](official-h3/references/ref-en.txt)，按其六段格式和保留关系定义编写。
4. 阅读 [本地动作与参考检查](h3-motion.md)。这是本项目的制作补充，不是官方规则；实际输入协议见 [H3 输入与提示](h3.md)。

官方文件逐字保留；上游示例仅说明格式，不代表当前服务启用了所有模式或支持精确复制音轨。能力以服务查询和预检为准。更新时从同一固定 revision 同步这三份原文，核对文件完整性，不在原文中加入本地规则。

## 来源与完整性

仓库路径与本地 SHA-256：

| 官方路径 | 本地文件 | SHA-256 |
| --- | --- | --- |
| [SKILL.md](https://github.com/MiniMax-AI/MiniMax-H3/blob/d21241f0a4b3acbb34c97dae47fa417b7065e438/skills/h3-prompt-writing/SKILL.md) | `official-h3/upstream-skill.md` | `a7000443588ca3f145e3b3fd8900f14e0325dc460bd811268fac89a9dc8e56d0` |
| [references/base-en.txt](https://github.com/MiniMax-AI/MiniMax-H3/blob/d21241f0a4b3acbb34c97dae47fa417b7065e438/skills/h3-prompt-writing/references/base-en.txt) | `official-h3/references/base-en.txt` | `2cfebc096a6e08370f288d468d90b60f7f9bcb938f94bf090816e910e48e75fc` |
| [references/ref-en.txt](https://github.com/MiniMax-AI/MiniMax-H3/blob/d21241f0a4b3acbb34c97dae47fa417b7065e438/skills/h3-prompt-writing/references/ref-en.txt) | `official-h3/references/ref-en.txt` | `1e574f356716ad55612247ffb7bbccbcdb484ad96599d63c7dca1af186b1fab7` |
