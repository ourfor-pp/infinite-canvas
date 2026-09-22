# Qwen Image 2.1 中立服务接入

模型 `qwen-image-2.1-local` 已通过统一 ComfyUI 接入本机中立 API，正式入口仍是 8290。画布图片模型选择器已接入；Codex 图片 MCP 未扩展，普通 Codex 生图继续使用原生能力。

## 固定来源与运行环境

- 官方推荐的 ModelScope `Comfy-Org/Qwen-Image-2.1`，revision `5dc8a8352312860d67e07cc9bee310dc7ed3e55c`，三份权重约 17.3 GB，SHA256 全部验证。
- INT8 ConvRot DiT、INT8 ConvRot Qwen3-VL 8B、BF16 RGBA VAE；文件实体在 SSD `/home/cec/.local/share/comfyui-models/Qwen-Image-2.1-5dc8a8352312`，稳定 Comfy 模型入口使用软链接。
- ComfyUI 0.37.0 `e638023d54497dbe0579565e5de4bb7076899592`，统一目录与虚拟环境；实际依赖保存在运行时 `installed-requirements.txt`，执行器 revision 绑定模型清单和该依赖记录。
- 唯一受管 unit `arcreel-comfyui-8189.service` 监听 `127.0.0.1:8189`，由统一 GPU 调度按需启动与卸载。Qwen 专用 8194 unit 与分流代码已删除，空闲旧 8190 实验进程已停止。H3 核心升级后 pipeline 指纹改变，旧状态不能跨版本续接；旧视频与离线回退目录保留。
- 来源与许可：[官方模型](https://github.com/QwenLM/Qwen-Image-2.1)、[官方推荐工作流](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_2_1_t2i.json)。Qwen Research License 的商业使用需按官方条款办理。

## 实际证据

样例与完整请求位于 `.tmp/qwen-image21/qualification/`，使用固定种子、1024×1024、40 步、Euler/simple、CFG 1：

| 样例 | Comfy 实际执行时间 | 验证 |
| --- | --- | --- |
| 文生图，蓝色陶瓷壶 | 9.345 秒 | 1024×1024 RGBA，alpha 范围 0–255，317454 个完全透明像素 |
| 单参考改为红色 | 10.132 秒 | 1024×1024 RGBA，alpha 范围 0–255，314195 个完全透明像素 |
| 两图合成，蓝壶在左、红壶在右 | 13.571 秒 | 正式 HTTP 上传两图、预检、幂等提交、状态查询、下载哈希和 ACK 均通过 |

上述时间为 Comfy history 的执行时间，不包含队列和完整请求处理。三张结果已实际查看，双色与摆放要求可见；单图编辑改变了表面材质，不能据此宣布高保真编辑或复杂身份保持已通过验收。最多 10 张参考是协议校验边界，真实测试使用 1 张和 2 张，未实测 10 张；2K 文生图见下方画布验证。

执行器 99 项自动测试、服务端 TypeScript 检查、Skill 格式校验和安装脚本语法检查通过。生成完成后经正式接口下载并核对 SHA256，保存本地样例后 ACK 清理临时结果。部署环境有备份，记录位于 `.tmp/qwen-image21/deployment.json`；其中不包含凭据。

统一实例的实际生成、续接、卸载和按需启动证据见下方合并验证。初次接入的分实例审计 `.tmp/qwen-image21/final-audit.txt` 仅是历史记录，不代表当前拓扑。

## 使用边界

`text-to-image` 使用显式宽高，`image-edit` 按首图比例与 referenceResolution 缩放。提示原样提交，透明效果需在提示中要求；不自动调用提示增强模型。参考图 RGB 与 alpha 同时传入 VAE。完整参数见服务 Skill 的 `references/qwen-image21.md`。

人物、多角色复杂参考、抠图边缘和真实业务画质仍待验收。H3 已通过新版核心的最小生成与续接链路验证，完整业务视频的视听质量仍需单独验收。

## 画布验证

- 模型下拉显示 `Qwen Image 2.1（本地媒体执行器）`，按执行器实际能力决定是否可用，支持文生图与最多 10 张参考编辑。
- 应用适配通用尺寸、单图数量和透明背景选项；编辑按首图比例使用参考分辨率。质量选项沿用模型默认 40 步，透明开关在应用层表达为提示，中立接口仍原样传递提示。
- 独立测试画布 `DVM2d_aRl7myz8nZs4898` 通过页面提交蓝色陶瓷茶杯文生图，任务 `FOyd3hRiiJEoCtYS1BJEW` 成功；2048×2048、40 步，模型执行 45.835 秒，图片保存为 `NLL9hcIy6vTmp_lTjv0uu` 并回填节点。实际页面图片加载完成，浏览器无脚本错误。
- 截图位于 `.tmp/qwen-image21/canvas-model-picker.png` 和 `.tmp/qwen-image21/canvas-generated.png`。画布目录、参数、参考上传及相关媒体回归共 20 项测试和服务端类型检查通过。画布参考编辑的参数链路通过自动测试，实际编辑画质仍以前述中立接口样例为限。

## 合并到单一 ComfyUI

- 当前运行目录为 `~/.local/share/infinite-media-executor/comfy-runtimes/ComfyUI-e638023d54497dbe0579565e5de4bb7076899592`；原稳定链接与 8189 unit 均指向该目录，复用原 H3 插件及媒体。执行器只保留 `COMFYUI_URL` 和 `MEDIA_EXECUTOR_COMFY_UNITS` 一套配置，能力缓存和显存调度共用版本指纹。
- 维护门禁及队列排空后备份执行器数据库和服务环境；备份定位在 `.tmp/comfy-unify/deployment.json`，不记录凭据。旧核心目录仅作离线回退，模型权重未删除。
- 统一实例真实 Qwen 文生图、参考编辑均通过：1024×1024、40 步，分别 9.333、10.438 秒。
- H3 PDD Ref2VA 生成 107 帧（4.458 秒）耗时 33.313 秒；原生续接新增 102 帧（4.25 秒）耗时 45.407 秒，累计 209 帧。新状态的视频与音频张量前缀与源状态逐值完全相等。此测试证明链路与状态保留，不作为完整视听质量验收。
- 上述四个任务均完成正式 HTTP 下载、SHA256 校验与 ACK；样例和请求保存在 `.tmp/comfy-unify/qwen/` 与 `.tmp/comfy-unify/h3/`。统一实例卸载并停止后，执行器按已验版本继续发现 Qwen/H3 能力。
- 执行器原 99 项测试与新增统一目录缓存回归通过；相关服务端 20 项测试通过。部署脚本语法检查通过，待办清单无需调整。

- 解除维护后，浏览器经应用 API 提交任务 `Un4E6vI2jOa6bBbGKGH8_`，自动启动同一 8189 unit；1024×1024/40 步生成成功（Comfy 执行 6.806 秒，不含启动时间），应用保存文件 `TD2r8UmidsrnTEEWerhz3`。最终审计仅 8189 ComfyUI 和 8290 执行器监听，maintenance=false，8190/8194 均无监听；证据为 `.tmp/comfy-unify/final-audit.txt` 与 `final-health.json`。
